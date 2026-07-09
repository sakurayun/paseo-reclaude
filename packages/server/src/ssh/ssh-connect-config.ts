import net from "node:net";
import type { Duplex } from "node:stream";
import { SocksClient } from "socks";
import type { ConnectConfig } from "ssh2";

import type { SshHostInfo } from "@getpaseo/protocol/messages";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";
import type { HostKeyVerdict, SshKnownHostStore } from "./ssh-known-host-store.js";

export interface ResolveConnectConfigDeps {
  hostStore: SshHostStore;
  keyStore: SshKeyStore;
  knownHostStore: SshKnownHostStore;
  // Tunnels through an ordered list of jump hosts (ProxyJump) and returns a
  // stream to `target` from the last hop. Implemented by the connection pool
  // (which owns hop connections) to avoid a circular import.
  buildChainSock: (
    chainHostIds: string[],
    target: { host: string; port: number },
  ) => Promise<Duplex>;
}

export interface HostKeyMismatch {
  host: string;
  port: number;
  keyType: string;
  fingerprintSha256: string;
  publicKeyBase64: string;
}

export interface ResolvedConnectConfig {
  config: ConnectConfig;
  // Startup snippet to write once the shell is open (undefined if none).
  startupSnippet?: string;
  // Charset for the terminal backend's byte transcoding ("utf-8" = passthrough).
  charset: string;
  backspaceMode: "del" | "ctrl-h";
  // Captures the last host-key mismatch observed during the handshake so the
  // caller can surface it to the UI. Reset per connect attempt.
  takeMismatch: () => HostKeyMismatch | null;
}

const DEFAULT_PORT = 22;

// Builds an ssh2 ConnectConfig from a stored host record. Resolves credentials
// from the key store / secrets, wires the TOFU host verifier, and lays out the
// proxy / host-chaining `sock` when present.
export async function resolveSsh2ConnectConfig(
  host: SshHostInfo,
  deps: ResolveConnectConfigDeps,
): Promise<ResolvedConnectConfig> {
  const port = host.port ?? DEFAULT_PORT;
  let mismatch: HostKeyMismatch | null = null;

  const config: ConnectConfig = {
    host: host.address,
    port,
    ...(host.username !== undefined ? { username: host.username } : {}),
    // We enforce TOFU ourselves; keep ssh2 from also rejecting.
    hostVerifier: (key: Buffer): boolean => {
      const verdict: HostKeyVerdict = deps.knownHostStore.verify({
        host: host.address,
        port,
        keyType: detectHostKeyType(key),
        publicKey: key,
      });
      if (verdict.outcome === "mismatch") {
        mismatch = {
          host: host.address,
          port,
          keyType: detectHostKeyType(key),
          fingerprintSha256: verdict.storedFingerprint,
          publicKeyBase64: key.toString("base64"),
        };
        return false;
      }
      return true;
    },
  };

  applyCredentials(config, host, deps.hostStore, deps.keyStore);

  const sock = await buildProxySock(host, deps);
  if (sock) {
    config.sock = sock;
  }

  return {
    config,
    ...(host.startupSnippet ? { startupSnippet: host.startupSnippet } : {}),
    charset: host.charset ?? "utf-8",
    backspaceMode: host.backspaceMode ?? "del",
    takeMismatch: () => {
      const value = mismatch;
      mismatch = null;
      return value;
    },
  };
}

function applyCredentials(
  config: ConnectConfig,
  host: SshHostInfo,
  hostStore: SshHostStore,
  keyStore: SshKeyStore,
): void {
  if (host.useAgent) {
    const agentSock =
      process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : process.env.SSH_AUTH_SOCK;
    if (agentSock) {
      config.agent = agentSock;
    }
    if (host.agentForwarding) {
      config.agentForward = true;
    }
  }

  if (host.keyId) {
    const material = keyStore.getMaterial(host.keyId);
    if (material) {
      config.privateKey = material.privateKey;
      if (material.passphrase !== undefined) {
        config.passphrase = material.passphrase;
      }
    }
  }

  const secrets = hostStore.getSecrets(host.id);
  if (secrets.password !== undefined) {
    config.password = secrets.password;
  }
}

// Establishes the first-hop transport when the host uses a proxy or host
// chaining. Host chaining takes precedence (ProxyJump): the last jump host's
// forwardOut stream becomes this host's `sock`.
async function buildProxySock(
  host: SshHostInfo,
  deps: ResolveConnectConfigDeps,
): Promise<Duplex | undefined> {
  const chain = host.chainHostIds ?? [];
  if (chain.length > 0) {
    return deps.buildChainSock(chain, {
      host: host.address,
      port: host.port ?? DEFAULT_PORT,
    });
  }

  if (host.proxy) {
    return buildProxyConnection(host.proxy, {
      host: host.address,
      port: host.port ?? DEFAULT_PORT,
      hostStore: deps.hostStore,
      hostId: host.id,
    });
  }

  return undefined;
}

async function buildProxyConnection(
  proxy: NonNullable<SshHostInfo["proxy"]>,
  target: { host: string; port: number; hostStore: SshHostStore; hostId: string },
): Promise<Duplex> {
  if (proxy.proxyType === "http") {
    return buildHttpConnectSock(proxy, target);
  }
  const password = target.hostStore.getSecrets(target.hostId).proxyPassword;
  const info = await SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: proxy.proxyType === "socks4" ? 4 : 5,
      ...(proxy.username !== undefined ? { userId: proxy.username } : {}),
      ...(password !== undefined ? { password } : {}),
    },
    command: "connect",
    destination: { host: target.host, port: target.port },
  });
  return info.socket;
}

// Minimal HTTP CONNECT tunnel — ssh2 has no built-in HTTP proxy support.
function buildHttpConnectSock(
  proxy: NonNullable<SshHostInfo["proxy"]>,
  target: { host: string; port: number },
): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host, () => {
      const headers = [
        `CONNECT ${target.host}:${target.port} HTTP/1.1`,
        `Host: ${target.host}:${target.port}`,
      ];
      if (proxy.username !== undefined) {
        const auth = Buffer.from(`${proxy.username}:`).toString("base64");
        headers.push(`Proxy-Authorization: Basic ${auth}`);
      }
      socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    });
    const onData = (chunk: Buffer): void => {
      const response = chunk.toString("utf8");
      const statusLine = response.split("\r\n")[0] ?? "";
      if (/\s2\d\d\s/.test(` ${statusLine} `)) {
        socket.removeListener("data", onData);
        resolve(socket);
      } else {
        socket.destroy();
        reject(new Error(`HTTP proxy CONNECT failed: ${statusLine}`));
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

// Extracts the SSH host-key algorithm name from the wire-format key blob:
// a 4-byte big-endian length prefix followed by the algorithm string.
export function detectHostKeyType(key: Buffer): string {
  if (key.length < 4) {
    return "unknown";
  }
  const length = key.readUInt32BE(0);
  if (length <= 0 || key.length < 4 + length) {
    return "unknown";
  }
  return key.subarray(4, 4 + length).toString("ascii");
}
