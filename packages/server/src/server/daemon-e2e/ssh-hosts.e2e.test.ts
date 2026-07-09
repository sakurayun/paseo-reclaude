import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import { Server, type Connection } from "ssh2";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

// Throwaway ed25519 host key for the in-process SSH test server.
const TEST_HOST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtwAAAJhh+/+BYfv/
gQAAAAtzc2gtZWQyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtw
AAAEAmtyzHID7Fl+E4K5B6NG4CIy+Qcm0l4s435WpeV0I3/dYHqLdaiapmXLlKfM3K+wlB
gFajKgmin2wyF+G82A+3AAAAEnBhc2VvLXRlc3QtZml4dHVyZQECAw==
-----END OPENSSH PRIVATE KEY-----`;

interface RunningSshServer {
  port: number;
  close: () => Promise<void>;
}

function startSshServer(): Promise<RunningSshServer> {
  const sockets = new Set<Connection>();
  const server = new Server({ hostKeys: [TEST_HOST_KEY] }, (client: Connection) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === "tester" && ctx.password === "pw") {
        ctx.accept();
      } else if (ctx.method === "none") {
        ctx.reject(["password"]);
      } else {
        ctx.reject();
      }
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty?.());
        session.on("shell", (acceptShell) => {
          const channel = acceptShell();
          channel.write("ssh-ready\r\n");
        });
        session.on("exec", (acceptExec, _reject, info) => {
          const channel = acceptExec();
          if (info.command.includes("os-release")) {
            channel.write('PRETTY_NAME="Ubuntu 22.04 LTS"\nID=ubuntu\nVERSION_ID="22.04"\n');
          }
          channel.exit(0);
          channel.end();
        });
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            // Force any lingering daemon connections closed so server.close()
            // doesn't block waiting on them.
            for (const socket of sockets) {
              socket.end();
            }
            server.close(() => done());
          }),
      });
    });
  });
}

describe("daemon E2E - SSH host manager", () => {
  let ctx: DaemonTestContext;
  let sshServer: RunningSshServer;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    sshServer = await startSshServer();
  });

  afterEach(async () => {
    // Close the daemon first (drops its ssh2 client connections), then the
    // test server — otherwise server.close() blocks on the open connection.
    await ctx.cleanup();
    await sshServer.close();
  }, 60_000);

  test("advertises the sshHosts capability", () => {
    const serverInfo = ctx.client.getLastServerInfoMessage();
    expect(serverInfo?.features?.sshHosts).toBe(true);
  });

  test("creates, lists, and connects to a host end-to-end", async () => {
    const createResponse = await ctx.client.createSshHost({
      host: {
        label: "Test box",
        address: "127.0.0.1",
        port: sshServer.port,
        username: "tester",
      },
      password: "pw",
    });
    expect(createResponse.error).toBeNull();
    expect(createResponse.host?.hasPassword).toBe(true);
    // The password must never come back over the wire.
    expect(JSON.stringify(createResponse.host)).not.toContain("pw");
    const hostId = createResponse.host!.id;

    const listResponse = await ctx.client.listSshHosts();
    expect(listResponse.hosts?.map((host) => host.id)).toContain(hostId);

    const connectResponse = await ctx.client.connectSshHost({ hostId, cols: 80, rows: 24 });
    expect(connectResponse.error).toBeNull();
    expect(connectResponse.terminal?.id).toBeTruthy();
    expect(connectResponse.terminal?.workspaceId).toBe(`ssh:${hostId}`);
  });

  test("round-trips the full field set through create + update", async () => {
    const created = await ctx.client.createSshHost({
      host: {
        label: "Box",
        address: "10.0.0.1",
        port: 22,
        username: "root",
        tags: ["prod"],
        env: { FOO: "bar" },
        charset: "gbk",
        backspaceMode: "ctrl-h",
        agentForwarding: true,
        proxy: { proxyType: "socks5", host: "proxy.local", port: 1080 },
      },
    });
    const hostId = created.host!.id;

    const updated = await ctx.client.updateSshHost({
      id: hostId,
      host: { label: "Renamed", port: 2222 },
    });
    expect(updated.error).toBeNull();
    expect(updated.host?.label).toBe("Renamed");
    expect(updated.host?.port).toBe(2222);
    // Untouched fields survive a partial update.
    expect(updated.host?.tags).toEqual(["prod"]);
    expect(updated.host?.env).toEqual({ FOO: "bar" });
    expect(updated.host?.charset).toBe("gbk");
    expect(updated.host?.backspaceMode).toBe("ctrl-h");
    expect(updated.host?.proxy).toMatchObject({ proxyType: "socks5", host: "proxy.local" });

    const deleted = await ctx.client.deleteSshHost(hostId);
    expect(deleted.success).toBe(true);
    const list = await ctx.client.listSshHosts();
    expect(list.hosts?.map((host) => host.id)).not.toContain(hostId);
  });

  test("returns a structured error when the host is unreachable", async () => {
    const createResponse = await ctx.client.createSshHost({
      host: { label: "Dead", address: "127.0.0.1", port: 1, username: "tester" },
      password: "pw",
    });
    const hostId = createResponse.host!.id;
    const connectResponse = await ctx.client.connectSshHost({ hostId });
    expect(connectResponse.terminal).toBeNull();
    expect(connectResponse.error).toBeTruthy();
  });
});
