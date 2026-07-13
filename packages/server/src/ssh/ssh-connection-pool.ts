import type { Duplex } from "node:stream";
import type { SshHostStore } from "./ssh-host-store.js";
import type { SshKeyStore } from "./ssh-key-store.js";
import type { SshKnownHostStore } from "./ssh-known-host-store.js";
import { SshConnection } from "./ssh-connection.js";
import {
  resolveSsh2ConnectConfig,
  type ConnectAttemptOptions,
  type HostKeyMismatch,
  type ResolveConnectConfigDeps,
} from "./ssh-connect-config.js";

export interface SshConnectionPoolDeps {
  hostStore: SshHostStore;
  keyStore: SshKeyStore;
  knownHostStore: SshKnownHostStore;
}

export interface AcquiredConnection {
  connection: SshConnection;
  charset: string;
  backspaceMode: "del" | "ctrl-h";
  startupSnippet?: string;
  // Decrements the ref count; the connection closes when it reaches zero.
  release: () => void;
}

// Raised when the handshake fails TOFU host-key verification. Carries the
// observed key so the UI can offer to update the fingerprint.
export class HostKeyMismatchError extends Error {
  constructor(readonly mismatch: HostKeyMismatch) {
    super(`Host key verification failed for ${mismatch.host}:${mismatch.port}`);
    this.name = "HostKeyMismatchError";
  }
}

interface PooledEntry {
  connection: SshConnection;
  refCount: number;
}

// Reference-counted pool of ssh2 connections keyed by host id. Terminals,
// platform-detection exec, and port forwards to the same host share one
// connection; it closes once the last consumer releases it.
export function createSshConnectionPool(deps: SshConnectionPoolDeps) {
  const entries = new Map<string, PooledEntry>();

  async function connectHost(
    hostId: string,
    options: ConnectAttemptOptions = {},
  ): Promise<SshConnection> {
    const host = deps.hostStore.getHost(hostId);
    if (!host) {
      throw new Error(`SSH host not found: ${hostId}`);
    }
    const configDeps: ResolveConnectConfigDeps = {
      hostStore: deps.hostStore,
      keyStore: deps.keyStore,
      knownHostStore: deps.knownHostStore,
      buildChainSock,
    };
    const resolved = await resolveSsh2ConnectConfig(host, configDeps, options);
    const connection = new SshConnection();
    try {
      await connection.connect(resolved.config);
    } catch (error) {
      connection.close();
      const mismatch = resolved.takeMismatch();
      if (mismatch) {
        throw new HostKeyMismatchError(mismatch);
      }
      throw error;
    }
    return connection;
  }

  // Tunnels through an ordered chain of jump hosts and returns a stream to the
  // final target. Each hop connects through the previous hop's forwardOut.
  async function buildChainSock(
    chainHostIds: string[],
    target: { host: string; port: number },
  ): Promise<Duplex> {
    let hopConnection: SshConnection | null = null;
    for (const hopId of chainHostIds) {
      const nextHop = deps.hostStore.getHost(hopId);
      if (!nextHop) {
        throw new Error(`SSH chain host not found: ${hopId}`);
      }
      const nextConnection = new SshConnection();
      const resolved = await resolveSsh2ConnectConfig(nextHop, {
        hostStore: deps.hostStore,
        keyStore: deps.keyStore,
        knownHostStore: deps.knownHostStore,
        // Nested chains are resolved by recursing through the hop's own record.
        buildChainSock,
      });
      if (hopConnection) {
        const channel = await hopConnection.forwardOut(
          "127.0.0.1",
          0,
          nextHop.address,
          nextHop.port ?? 22,
        );
        resolved.config.sock = channel;
      }
      await nextConnection.connect(resolved.config);
      hopConnection = nextConnection;
    }
    if (!hopConnection) {
      throw new Error("Empty SSH chain");
    }
    return hopConnection.forwardOut("127.0.0.1", 0, target.host, target.port);
  }

  return {
    async acquire(
      hostId: string,
      options: ConnectAttemptOptions = {},
    ): Promise<AcquiredConnection> {
      let entry = entries.get(hostId);
      // A password override / debug stream implies a fresh authenticated
      // handshake: drop any pooled connection so the new credential is actually
      // exercised and the ssh2 debug lines are captured.
      if (entry && options.passwordOverride !== undefined) {
        entries.delete(hostId);
        entry = undefined;
      }
      if (!entry || entry.connection.isClosed()) {
        const connection = await connectHost(hostId, options);
        entry = { connection, refCount: 0 };
        entries.set(hostId, entry);
        connection.onClose(() => {
          if (entries.get(hostId)?.connection === connection) {
            entries.delete(hostId);
          }
        });
      }
      entry.refCount += 1;
      const host = deps.hostStore.getHost(hostId);
      const currentEntry = entry;
      const acquired: AcquiredConnection = {
        connection: entry.connection,
        charset: host?.charset ?? "utf-8",
        backspaceMode: host?.backspaceMode ?? "del",
        ...(host?.startupSnippet ? { startupSnippet: host.startupSnippet } : {}),
        release: () => {
          currentEntry.refCount -= 1;
          if (currentEntry.refCount <= 0) {
            entries.delete(hostId);
            currentEntry.connection.close();
          }
        },
      };
      return acquired;
    },

    dispose(): void {
      for (const entry of entries.values()) {
        entry.connection.close();
      }
      entries.clear();
    },
  };
}

export type SshConnectionPool = ReturnType<typeof createSshConnectionPool>;
