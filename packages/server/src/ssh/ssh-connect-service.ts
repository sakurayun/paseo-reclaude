import path from "node:path";

import {
  createSshConnectionPool,
  HostKeyMismatchError,
  type SshConnectionPool,
} from "./ssh-connection-pool.js";
import { createSshTerminalBackend } from "./ssh-terminal-backend.js";
import { detectRemotePlatform } from "./ssh-platform-detect.js";
import { buildFallbackSshArgv } from "./ssh-fallback.js";
import type { SshConnectHandler, SshConnectResult } from "./ssh-session-controller.js";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { SshManager } from "./ssh-manager.js";

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
}

// Hosts that need the system ssh/mosh binary: ssh2 supports neither Mosh nor
// FIDO2 (sk-*) keys.
function needsFallback(host: SshHostInfo): boolean {
  return Boolean(host.mosh?.enabled) || Boolean(host.useFido2);
}

export interface SshConnectService {
  pool: SshConnectionPool;
  createConnectHandler: () => SshConnectHandler;
  dispose: () => void;
}

const WORKSPACE_PREFIX = "ssh:";

export function createSshConnectService(deps: SshConnectServiceDeps): SshConnectService {
  const { sshManager, sshTerminalManager, fallbackTerminalManager, sshHome } = deps;
  const pool = createSshConnectionPool({
    hostStore: sshManager.hostStore,
    keyStore: sshManager.keyStore,
    knownHostStore: sshManager.knownHostStore,
  });

  async function connectViaFallback(host: SshHostInfo, logId: string): Promise<SshConnectResult> {
    const argv = buildFallbackSshArgv(host, {
      hostStore: sshManager.hostStore,
      keyStore: sshManager.keyStore,
      sshHome,
    });
    try {
      const terminal = await fallbackTerminalManager.createTerminal({
        cwd: sshHome,
        workspaceId: `${WORKSPACE_PREFIX}${host.id}`,
        name: host.label,
        command: argv.command,
        args: argv.args,
      });
      sshManager.logStore.markConnected(logId);
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

  const handler: SshConnectHandler = async (input) => {
    const host = sshManager.hostStore.getHost(input.hostId);
    if (!host) {
      return { outcome: "error", error: "SSH host not found" };
    }

    const logId = sshManager.logStore.begin({
      hostId: host.id,
      hostLabel: host.label,
      ...(host.username !== undefined ? { username: host.username } : {}),
      address: host.address,
      ...(host.port !== undefined ? { port: host.port } : {}),
      protocol: host.mosh?.enabled ? "mosh" : "ssh",
    });

    if (needsFallback(host)) {
      return connectViaFallback(host, logId);
    }

    let acquired;
    try {
      acquired = await pool.acquire(host.id);
    } catch (error) {
      if (error instanceof HostKeyMismatchError) {
        sshManager.logStore.complete(logId, {
          status: "failed",
          error: error.message,
        });
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
      const message = error instanceof Error ? error.message : String(error);
      sshManager.logStore.complete(logId, { status: "failed", error: message });
      return { outcome: "error", error: message };
    }

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
        cwd: sshHome,
        workspaceId: `${WORKSPACE_PREFIX}${host.id}`,
        name: host.label,
        backend,
      });

      sshManager.logStore.markConnected(logId);

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
