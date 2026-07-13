import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { writePrivateFileAtomicSync } from "../server/private-files.js";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";

export interface FallbackCommand {
  command: string;
  args: string[];
  // Removes any temporary key file written for this invocation.
  cleanup: () => void;
}

export interface BuildFallbackDeps {
  hostStore: SshHostStore;
  keyStore: SshKeyStore;
  sshHome: string;
}

// Hosts that need the system ssh/mosh binary: ssh2 supports neither Mosh nor
// FIDO2 (sk-*) keys. Such hosts have no pooled ssh2 connection, so SFTP-based
// features (drag-drop uploads) are unavailable for them too.
export function sshHostNeedsFallback(host: SshHostInfo): boolean {
  return Boolean(host.mosh?.enabled) || Boolean(host.useFido2);
}

// Builds an argv for the system `ssh`/`mosh` binary. Used when a host requires
// a path ssh2 can't take: Mosh, or a FIDO2 (sk-*) key. Password/proxy auth is
// not injected here — the pty surfaces any prompts interactively.
//
// Agent options mirror the ssh2 path (see applyCredentials):
// - useAgent: leave IdentityAgent alone so OpenSSH uses $SSH_AUTH_SOCK
// - !useAgent && !agentForwarding: IdentityAgent=none so a host-scoped key/password
//   is not contaminated by unrelated agent identities
// - agentForwarding: -A (ForwardAgent), which still needs a local agent even when
//   login uses -i / password
export function buildFallbackSshArgv(host: SshHostInfo, deps: BuildFallbackDeps): FallbackCommand {
  const port = host.port ?? 22;
  const userHost = host.username ? `${host.username}@${host.address}` : host.address;

  let keyFile: string | null = null;
  let cleanup = (): void => {};
  if (host.keyId) {
    const material = deps.keyStore.getMaterial(host.keyId);
    if (material) {
      const dir = path.join(deps.sshHome, "tmp-keys");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      keyFile = path.join(dir, `${randomUUID()}.key`);
      writePrivateFileAtomicSync(keyFile, material.privateKey);
      const file = keyFile;
      cleanup = () => {
        try {
          rmSync(file, { force: true });
        } catch {
          // best-effort
        }
      };
    }
  }

  const sshOptions = buildSshOptions({ host, port, keyFile, deps });

  if (host.mosh?.enabled) {
    const inner = ["ssh", ...sshOptions].join(" ");
    const args = [`--ssh=${inner}`];
    if (host.mosh.serverPath) {
      args.push(`--server=${host.mosh.serverPath}`);
    }
    args.push(userHost);
    return { command: "mosh", args, cleanup };
  }

  return { command: "ssh", args: [...sshOptions, userHost], cleanup };
}

function buildSshOptions(input: {
  host: SshHostInfo;
  port: number;
  keyFile: string | null;
  deps: BuildFallbackDeps;
}): string[] {
  const { host, port, keyFile, deps } = input;
  const options: string[] = [];
  if (port !== 22) {
    options.push("-p", String(port));
  }
  if (keyFile) {
    options.push("-i", keyFile);
    // Prefer the host-selected key for login when agent auth is not requested.
    // IdentitiesOnly still allows ForwardAgent (-A) to expose the agent on the remote.
    if (!host.useAgent) {
      options.push("-o", "IdentitiesOnly=yes");
    }
  }
  // When neither agent auth nor forwarding is wanted, disable the agent entirely
  // so OpenSSH does not offer unexpected identities from the ambient agent.
  if (!host.useAgent && !host.agentForwarding) {
    options.push("-o", "IdentityAgent=none");
  }
  const jump = buildJumpSpec(host, deps.hostStore);
  if (jump) {
    options.push("-J", jump);
  }
  for (const [key, value] of Object.entries(host.env ?? {})) {
    options.push("-o", `SetEnv=${key}=${value}`);
  }
  // OpenSSH -A / ForwardAgent yes — independent of useAgent.
  if (host.agentForwarding) {
    options.push("-A");
  }
  return options;
}

// Renders the ProxyJump (-J) spec from chained host records: user@addr[:port].
function buildJumpSpec(host: SshHostInfo, hostStore: SshHostStore): string | null {
  const chain = host.chainHostIds ?? [];
  if (chain.length === 0) {
    return null;
  }
  const hops = chain
    .map((hopId) => hostStore.getHost(hopId))
    .filter((hop): hop is SshHostInfo => hop != null)
    .map((hop) => {
      const base = hop.username ? `${hop.username}@${hop.address}` : hop.address;
      return hop.port && hop.port !== 22 ? `${base}:${hop.port}` : base;
    });
  return hops.length > 0 ? hops.join(",") : null;
}
