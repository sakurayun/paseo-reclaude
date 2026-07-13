import path from "node:path";

import {
  createSshConnectionPool,
  HostKeyMismatchError,
  type SshConnectionPool,
} from "./ssh-connection-pool.js";
import { SshAuthFailedError } from "./ssh-connection.js";
import { SshAgentUnavailableError } from "./ssh-connect-config.js";
import { classifySshConnectError, shouldTrySystemSshFallback } from "./ssh-connect-error.js";
import { createSshTerminalBackend } from "./ssh-terminal-backend.js";
import { detectRemotePlatform } from "./ssh-platform-detect.js";
import { buildFallbackSshArgv, sshHostNeedsFallback } from "./ssh-fallback.js";
import type { SshConnectHandler, SshConnectResult } from "./ssh-session-controller.js";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { TerminalSession } from "../terminal/terminal.js";
import type { SshManager } from "./ssh-manager.js";
import type { SshTerminalRegistry } from "./ssh-terminal-registry.js";

export interface SshConnectServiceDeps {
  sshManager: SshManager;
  // In-process terminal manager that hosts ssh2 shell sessions.
  sshTerminalManager: TerminalManager;
  // Worker-backed manager used for Mosh/FIDO2 fallback (a real pty spawning the
  // system ssh/mosh binary).
  fallbackTerminalManager: TerminalManager;
  // Base directory (PASEO_HOME/ssh) used as the synthetic cwd for SSH
  // terminals — only affects snapshot cache scoping, never disk access.
  sshHome: string;
  // terminalId → host mapping consumed by MCP tools and the reveal push.
  terminalRegistry?: SshTerminalRegistry;
}

export interface SshConnectService {
  pool: SshConnectionPool;
  createConnectHandler: () => SshConnectHandler;
  dispose: () => void;
}

const WORKSPACE_PREFIX = "ssh:";

export function createSshConnectService(deps: SshConnectServiceDeps): SshConnectService {
  const { sshManager, sshTerminalManager, fallbackTerminalManager, sshHome, terminalRegistry } =
    deps;

  function trackSshTerminal(
    terminal: Pick<TerminalSession, "id" | "onExit">,
    host: SshHostInfo,
    via: "ssh2" | "fallback",
  ): void {
    if (!terminalRegistry) {
      return;
    }
    terminalRegistry.register(terminal.id, {
      hostId: host.id,
      hostLabel: host.label,
      via,
      connectedAt: Date.now(),
    });
    terminal.onExit(() => terminalRegistry.unregister(terminal.id));
  }
  const pool = createSshConnectionPool({
    hostStore: sshManager.hostStore,
    keyStore: sshManager.keyStore,
    knownHostStore: sshManager.knownHostStore,
  });

  interface TerminalPlacement {
    workspaceId: string;
    cwd: string;
    // Initial pty size. The daemon-side headless terminal MUST match the
    // remote pty from the first byte: the login banner renders at this size,
    // and a later resize cannot cleanly reflow output the remote positioned
    // with absolute coordinates (the "cursor stuck mid-history" artifact).
    cols?: number;
    rows?: number;
  }

  // Where the terminal record lives: the client-provided workspace, so the SSH
  // terminal lists/groups/archives like a local workspace terminal. Old clients
  // omit the placement and fall back to the synthetic ssh:<hostId> bucket. The
  // cwd only scopes the record and its snapshot cache — the remote shell never
  // touches the daemon filesystem — but it must be absolute for createTerminal.
  function resolveTerminalPlacement(
    input: { workspaceId?: string; cwd?: string; cols?: number; rows?: number },
    hostId: string,
  ): TerminalPlacement {
    const workspaceId = input.workspaceId?.trim();
    const cwd = input.cwd?.trim();
    return {
      workspaceId: workspaceId || `${WORKSPACE_PREFIX}${hostId}`,
      cwd: cwd && path.isAbsolute(cwd) ? cwd : sshHome,
      ...(input.cols !== undefined ? { cols: input.cols } : {}),
      ...(input.rows !== undefined ? { rows: input.rows } : {}),
    };
  }

  function placementCreateOptions(placement: TerminalPlacement): {
    cwd: string;
    workspaceId: string;
    cols?: number;
    rows?: number;
  } {
    return {
      cwd: placement.cwd,
      workspaceId: placement.workspaceId,
      ...(placement.cols !== undefined ? { cols: placement.cols } : {}),
      ...(placement.rows !== undefined ? { rows: placement.rows } : {}),
    };
  }

  async function connectViaFallback(
    host: SshHostInfo,
    logId: string,
    placement: TerminalPlacement,
  ): Promise<SshConnectResult> {
    const argv = buildFallbackSshArgv(host, {
      hostStore: sshManager.hostStore,
      keyStore: sshManager.keyStore,
      sshHome,
    });
    try {
      const terminal = await fallbackTerminalManager.createTerminal({
        ...placementCreateOptions(placement),
        name: host.label,
        command: argv.command,
        args: argv.args,
      });
      sshManager.logStore.markConnected(logId);
      trackSshTerminal(terminal, host, "fallback");
      // The temp key file must outlive spawn; drop it once the terminal exits.
      terminal.onExit(() => {
        argv.cleanup();
        sshManager.logStore.complete(logId, { status: "closed" });
      });
      return {
        outcome: "connected",
        terminal: {
          id: terminal.id,
          name: terminal.name,
          cwd: terminal.cwd,
          workspaceId: terminal.workspaceId,
        },
      };
    } catch (error) {
      argv.cleanup();
      const message = error instanceof Error ? error.message : String(error);
      sshManager.logStore.complete(logId, { status: "failed", error: message });
      return { outcome: "error", error: message };
    }
  }

  async function handleSsh2AcquireFailure(input: {
    error: unknown;
    host: SshHostInfo;
    logId: string;
    placement: TerminalPlacement;
    progress: (line: string, level?: "info" | "error") => void;
    connectViaFallback: (
      host: SshHostInfo,
      logId: string,
      placement: TerminalPlacement,
    ) => Promise<SshConnectResult>;
    logStore: SshManager["logStore"];
  }): Promise<SshConnectResult> {
    const { error, host, logId, placement, progress, logStore } = input;
    if (error instanceof HostKeyMismatchError) {
      logStore.complete(logId, { status: "failed", error: error.message });
      progress(error.message, "error");
      return {
        outcome: "host_key_mismatch",
        error: error.message,
        observedKey: {
          host: error.mismatch.host,
          port: error.mismatch.port,
          keyType: error.mismatch.keyType,
          fingerprintSha256: error.mismatch.fingerprintSha256,
          publicKeyBase64: error.mismatch.publicKeyBase64,
        },
      };
    }
    if (error instanceof SshAuthFailedError) {
      logStore.complete(logId, { status: "failed", error: error.message });
      progress(error.message, "error");
      return { outcome: "auth_failed", error: error.message };
    }
    if (error instanceof SshAgentUnavailableError) {
      logStore.complete(logId, { status: "failed", error: error.message });
      progress(error.message, "error");
      return { outcome: "error", error: error.message };
    }

    const classified = classifySshConnectError(error);
    progress(classified.message, "error");
    for (const hint of classified.hints) {
      progress(hint, "error");
    }

    // When the pure-JS ssh2 path dies before the protocol starts (or with an
    // opaque network error), try the system OpenSSH client once. It can pick
    // up ~/.ssh/config ProxyJump / IdentityAgent that ssh2 does not, and on
    // some hosts algorithm negotiation differs.
    if (shouldTrySystemSshFallback(classified.kind)) {
      progress("ssh2 handshake failed — retrying with system ssh…");
      return input.connectViaFallback(host, logId, placement);
    }

    logStore.complete(logId, { status: "failed", error: classified.message });
    return { outcome: "error", error: classified.message };
  }

  const handler: SshConnectHandler = async (input) => {
    const host = sshManager.hostStore.getHost(input.hostId);
    if (!host) {
      return { outcome: "error", error: "SSH host not found" };
    }

    // Curated step lines + ssh2 debug output stream to the connecting tab.
    const progress = (line: string, level: "info" | "error" = "info"): void =>
      input.onProgress?.(line, level);

    const logId = sshManager.logStore.begin({
      hostId: host.id,
      hostLabel: host.label,
      ...(host.username !== undefined ? { username: host.username } : {}),
      address: host.address,
      ...(host.port !== undefined ? { port: host.port } : {}),
      protocol: host.mosh?.enabled ? "mosh" : "ssh",
    });

    const placement = resolveTerminalPlacement(input, host.id);
    if (sshHostNeedsFallback(host)) {
      return connectViaFallback(host, logId, placement);
    }

    const target = `${host.username ? `${host.username}@` : ""}${host.address}:${host.port ?? 22}`;
    progress(`Connecting to ${target}…`);

    let acquired;
    try {
      acquired = await pool.acquire(host.id, {
        ...(input.password !== undefined ? { passwordOverride: input.password } : {}),
        onDebug: (line) => progress(line),
      });
    } catch (error) {
      return handleSsh2AcquireFailure({
        error,
        host,
        logId,
        placement,
        progress,
        connectViaFallback,
        logStore: sshManager.logStore,
      });
    }

    progress("Authenticated. Opening shell…");
    try {
      const channel = await acquired.connection.shell({
        cols: input.cols ?? 80,
        rows: input.rows ?? 24,
        ...(host.env ? { env: host.env } : {}),
      });

      let released = false;
      const releaseOnce = (): void => {
        if (!released) {
          released = true;
          acquired.release();
        }
      };

      const backend = createSshTerminalBackend({
        channel,
        charset: acquired.charset,
        backspaceMode: acquired.backspaceMode,
        onClosed: () => {
          sshManager.logStore.complete(logId, { status: "closed" });
          releaseOnce();
        },
      });

      const terminal = await sshTerminalManager.createTerminal({
        ...placementCreateOptions(placement),
        name: host.label,
        backend,
      });

      sshManager.logStore.markConnected(logId);
      trackSshTerminal(terminal, host, "ssh2");
      progress("Session ready.");

      if (acquired.startupSnippet) {
        channel.write(`${acquired.startupSnippet}\n`);
      }

      // Detect the remote platform in the background and write it back.
      void detectRemotePlatform(acquired.connection)
        .then((platform) => sshManager.hostStore.setPlatform(host.id, platform))
        .catch(() => {
          // best-effort metadata
        });

      const result: SshConnectResult = {
        outcome: "connected",
        terminal: {
          id: terminal.id,
          name: terminal.name,
          cwd: terminal.cwd,
          workspaceId: terminal.workspaceId,
        },
      };
      return result;
    } catch (error) {
      acquired.release();
      const message = error instanceof Error ? error.message : String(error);
      sshManager.logStore.complete(logId, { status: "failed", error: message });
      return { outcome: "error", error: message };
    }
  };

  return {
    pool,
    createConnectHandler: () => handler,
    dispose: () => {
      pool.dispose();
    },
  };
}

export function sshWorkspaceId(hostId: string): string {
  return `${WORKSPACE_PREFIX}${hostId}`;
}

export function sshHomeDirectory(paseoHome: string): string {
  return path.join(paseoHome, "ssh");
}
