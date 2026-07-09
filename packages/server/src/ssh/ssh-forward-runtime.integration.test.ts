import net, { type AddressInfo } from "node:net";
import { Server, type Connection } from "ssh2";
import { afterEach, describe, expect, it } from "vitest";

import { createSshConnectionPool } from "./ssh-connection-pool.js";
import { createSshForwardRuntime } from "./ssh-forward-runtime.js";
import { createSshForwardStore } from "./ssh-forward-store.js";
import { createSshHostStore } from "./ssh-host-store.js";
import { createSshKeyStore } from "./ssh-key-store.js";
import { createSshKnownHostStore } from "./ssh-known-host-store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_HOST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtwAAAJhh+/+BYfv/
gQAAAAtzc2gtZWQyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtw
AAAEAmtyzHID7Fl+E4K5B6NG4CIy+Qcm0l4s435WpeV0I3/dYHqLdaiapmXLlKfM3K+wlB
gFajKgmin2wyF+G82A+3AAAAEnBhc2VvLXRlc3QtZml4dHVyZQECAw==
-----END OPENSSH PRIVATE KEY-----`;

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "ssh-fwd-"));
}

// A TCP echo server used as the forward target.
function startEchoServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => socket.write(chunk));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// An ssh2 server that services direct-tcpip channels (what forwardOut opens) by
// dialing the requested destination and piping bytes through.
function startSshServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Connection>();
  const server = new Server({ hostKeys: [TEST_HOST_KEY] }, (client: Connection) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("authentication", (ctx) => ctx.accept());
    client.on("ready", () => {
      client.on("tcpip", (accept, _reject, info) => {
        const channel = accept();
        const upstream = net.connect(info.destPort, info.destIP, () => {
          channel.pipe(upstream).pipe(channel);
        });
        upstream.on("error", () => channel.close());
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) {
              socket.end();
            }
            server.close(() => done());
          }),
      });
    });
  });
}

describe("SSH local port forwarding", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup();
    }
  });

  it("forwards a local listener through the SSH connection to a target", async () => {
    const echo = await startEchoServer();
    cleanups.push(echo.close);
    const sshServer = await startSshServer();
    cleanups.push(sshServer.close);

    const dir = tempDir();
    const hostStore = createSshHostStore({
      hostsPath: path.join(dir, "ssh-hosts.json"),
      secretsPath: path.join(dir, "ssh-secrets.json"),
    });
    cleanups.push(async () => hostStore.dispose());
    const keyStore = createSshKeyStore({ storePath: path.join(dir, "ssh-keys.json") });
    cleanups.push(async () => keyStore.dispose());
    const knownHostStore = createSshKnownHostStore({
      storePath: path.join(dir, "ssh-known-hosts.json"),
    });
    cleanups.push(async () => knownHostStore.dispose());
    const forwardStore = createSshForwardStore({ storePath: path.join(dir, "ssh-forwards.json") });
    cleanups.push(async () => forwardStore.dispose());

    const host = hostStore.createHost({
      host: { label: "Box", address: "127.0.0.1", port: sshServer.port, username: "tester" },
    });
    const pool = createSshConnectionPool({ hostStore, keyStore, knownHostStore });
    cleanups.push(async () => pool.dispose());
    const runtime = createSshForwardRuntime({ forwardStore, pool });
    cleanups.push(() => runtime.dispose());

    const forward = forwardStore.create({
      hostId: host.id,
      forwardType: "local",
      listenPort: 0, // ephemeral local port
      bindAddress: "127.0.0.1",
      targetHost: "127.0.0.1",
      targetPort: echo.port,
    });
    // listenPort 0 → the store keeps 0; start() will listen on an OS-assigned
    // port. Re-create with a concrete port so the client can connect.
    forwardStore.delete(forward.id);

    // Pick a concrete free port for the local listener.
    const probe = net.createServer();
    const localPort = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => resolve((probe.address() as AddressInfo).port));
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const rule = forwardStore.create({
      hostId: host.id,
      forwardType: "local",
      listenPort: localPort,
      bindAddress: "127.0.0.1",
      targetHost: "127.0.0.1",
      targetPort: echo.port,
    });

    const started = await runtime.start(rule.id);
    expect(started.ok).toBe(true);
    expect(forwardStore.list().runtime[0]?.status).toBe("active");

    // Connect through the local forward and verify the echo round-trips.
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(localPort, "127.0.0.1", () => socket.write("ping"));
      socket.on("data", (chunk) => {
        resolve(chunk.toString("utf8"));
        socket.end();
      });
      socket.on("error", reject);
    });
    expect(echoed).toBe("ping");

    await runtime.stop(rule.id);
    expect(forwardStore.list().runtime[0]?.status).toBe("stopped");
  });
});
