import type { AddressInfo } from "node:net";
import { Server, type Connection } from "ssh2";
import { afterEach, describe, expect, it } from "vitest";

import { SshConnection } from "./ssh-connection.js";

// Throwaway ed25519 host key for the in-process test server (never used
// anywhere real).
const TEST_HOST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtwAAAJhh+/+BYfv/
gQAAAAtzc2gtZWQyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtw
AAAEAmtyzHID7Fl+E4K5B6NG4CIy+Qcm0l4s435WpeV0I3/dYHqLdaiapmXLlKfM3K+wlB
gFajKgmin2wyF+G82A+3AAAAEnBhc2VvLXRlc3QtZml4dHVyZQECAw==
-----END OPENSSH PRIVATE KEY-----`;

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

// Starts an ssh2 server that accepts password auth and answers a shell (echoes
// a banner) and a single exec (prints os-release).
function startTestServer(): Promise<RunningServer> {
  const server = new Server({ hostKeys: [TEST_HOST_KEY] }, (client: Connection) => {
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
        session.on("pty", (acceptPty) => {
          acceptPty?.();
        });
        session.on("shell", (acceptShell) => {
          const channel = acceptShell();
          channel.write("shell-ready\r\n");
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
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

describe("SshConnection against an in-process ssh2 server", () => {
  const servers: RunningServer[] = [];
  const connections: SshConnection[] = [];
  afterEach(async () => {
    for (const connection of connections.splice(0)) {
      connection.close();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  it("connects with password auth and opens a shell that streams data", async () => {
    const server = await startTestServer();
    servers.push(server);

    const connection = new SshConnection();
    connections.push(connection);
    await connection.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "tester",
      password: "pw",
      hostVerifier: () => true,
    });

    const channel = await connection.shell({ cols: 80, rows: 24 });
    const data = await new Promise<string>((resolve) => {
      let buffer = "";
      channel.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (buffer.includes("shell-ready")) {
          resolve(buffer);
        }
      });
    });
    expect(data).toContain("shell-ready");
  });

  it("runs exec and returns stdout for platform detection", async () => {
    const server = await startTestServer();
    servers.push(server);

    const connection = new SshConnection();
    connections.push(connection);
    await connection.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "tester",
      password: "pw",
      hostVerifier: () => true,
    });

    const result = await connection.exec("cat /etc/os-release 2>/dev/null || uname -s");
    expect(result.stdout).toContain("ID=ubuntu");
    expect(result.code).toBe(0);
  });

  it("rejects a wrong password", async () => {
    const server = await startTestServer();
    servers.push(server);

    const connection = new SshConnection();
    connections.push(connection);
    await expect(
      connection.connect({
        host: "127.0.0.1",
        port: server.port,
        username: "tester",
        password: "wrong",
        hostVerifier: () => true,
      }),
    ).rejects.toThrow();
  });
});
