import net from "node:net";
import type { SshForwardInfo } from "@getpaseo/protocol/messages";

import type { SshForwardStore } from "./ssh-forward-store.js";
import type { SshConnectionPool } from "./ssh-connection-pool.js";
import { runSocks5Server } from "./ssh-socks5.js";

export interface SshForwardRuntimeDeps {
  forwardStore: SshForwardStore;
  pool: SshConnectionPool;
}

interface ActiveForward {
  stop: () => Promise<void>;
}

const DEFAULT_BIND = "127.0.0.1";

// Owns the live listeners for SSH port forwards. Each rule, when started,
// acquires a pooled connection and stands up a local listener (local/dynamic)
// or a remote listen request (remote). Status transitions are written back to
// the forward store, which broadcasts them.
export function createSshForwardRuntime(deps: SshForwardRuntimeDeps) {
  const active = new Map<string, ActiveForward>();

  async function start(forwardId: string): Promise<{ ok: boolean; error?: string }> {
    const forward = deps.forwardStore.getForward(forwardId);
    if (!forward) {
      return { ok: false, error: "Forward not found" };
    }
    if (active.has(forwardId)) {
      return { ok: true };
    }
    deps.forwardStore.setRuntime(forwardId, "starting");
    try {
      const acquired = await deps.pool.acquire(forward.hostId);
      const stopListener = await startListener(forward, acquired.connection);
      active.set(forwardId, {
        stop: async () => {
          await stopListener();
          acquired.release();
        },
      });
      deps.forwardStore.setRuntime(forwardId, "active");
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.forwardStore.setRuntime(forwardId, "error", message);
      return { ok: false, error: message };
    }
  }

  async function stop(forwardId: string): Promise<{ ok: boolean }> {
    const entry = active.get(forwardId);
    if (!entry) {
      deps.forwardStore.setRuntime(forwardId, "stopped");
      return { ok: true };
    }
    active.delete(forwardId);
    await entry.stop();
    deps.forwardStore.setRuntime(forwardId, "stopped");
    return { ok: true };
  }

  async function startListener(
    forward: SshForwardInfo,
    connection: Parameters<typeof runLocalForward>[1],
  ): Promise<() => Promise<void>> {
    switch (forward.forwardType) {
      case "local":
        return runLocalForward(forward, connection);
      case "dynamic":
        return runDynamicForward(forward, connection);
      case "remote":
        return runRemoteForward(forward, connection);
      default:
        throw new Error(`Unknown forward type: ${forward.forwardType}`);
    }
  }

  return {
    start,
    stop,
    async dispose(): Promise<void> {
      const entries = Array.from(active.values());
      active.clear();
      await Promise.all(entries.map((entry) => entry.stop()));
    },
  };
}

type PooledConnection = Awaited<ReturnType<SshConnectionPool["acquire"]>>["connection"];

// -L: local listener → forwardOut to targetHost:targetPort on the remote side.
function runLocalForward(
  forward: SshForwardInfo,
  connection: PooledConnection,
): Promise<() => Promise<void>> {
  const bindAddress = forward.bindAddress ?? DEFAULT_BIND;
  const targetHost = forward.targetHost ?? "127.0.0.1";
  const targetPort = forward.targetPort ?? forward.listenPort;
  const server = net.createServer((socket) => {
    void pipeLocalSocket(connection, socket, targetHost, targetPort);
  });
  return listen(server, forward.listenPort, bindAddress);
}

async function pipeLocalSocket(
  connection: PooledConnection,
  socket: net.Socket,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  try {
    const channel = await connection.forwardOut(
      socket.remoteAddress ?? "127.0.0.1",
      socket.remotePort ?? 0,
      targetHost,
      targetPort,
    );
    socket.pipe(channel).pipe(socket);
    socket.on("error", () => channel.close());
    channel.on("error", () => socket.destroy());
  } catch {
    socket.destroy();
  }
}

// -D: local SOCKS5 server → forwardOut to whatever the SOCKS client requests.
function runDynamicForward(
  forward: SshForwardInfo,
  connection: PooledConnection,
): Promise<() => Promise<void>> {
  const bindAddress = forward.bindAddress ?? DEFAULT_BIND;
  return runSocks5Server({
    bindAddress,
    port: forward.listenPort,
    connect: (host, port) => connection.forwardOut("127.0.0.1", 0, host, port),
  });
}

// -R: ask the server to listen; each pushed connection → net.connect locally.
async function runRemoteForward(
  forward: SshForwardInfo,
  connection: PooledConnection,
): Promise<() => Promise<void>> {
  const bindAddress = forward.bindAddress ?? DEFAULT_BIND;
  const targetHost = forward.targetHost ?? "127.0.0.1";
  const targetPort = forward.targetPort ?? forward.listenPort;
  const unsubscribe = connection.onTcpConnection((info, accept) => {
    if (info.destPort !== forward.listenPort) {
      return;
    }
    const channel = accept();
    const socket = net.connect(targetPort, targetHost, () => {
      socket.pipe(channel).pipe(socket);
    });
    socket.on("error", () => channel.close());
    channel.on("error", () => socket.destroy());
  });
  await connection.forwardIn(bindAddress, forward.listenPort);
  return async () => {
    unsubscribe();
    connection.unforwardIn(bindAddress, forward.listenPort);
  };
}

function listen(
  server: net.Server,
  port: number,
  bindAddress: string,
): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindAddress, () => {
      server.removeListener("error", reject);
      resolve(
        () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      );
    });
  });
}

export type SshForwardRuntime = ReturnType<typeof createSshForwardRuntime>;
