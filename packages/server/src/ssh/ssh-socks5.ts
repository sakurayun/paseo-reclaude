import net from "node:net";
import type { ClientChannel } from "ssh2";

export interface Socks5ServerOptions {
  bindAddress: string;
  port: number;
  // Opens a tunneled channel to the requested destination (via forwardOut).
  connect: (host: string, port: number) => Promise<ClientChannel>;
}

// Minimal SOCKS5 server (CONNECT command, no authentication) used for dynamic
// (-D) forwarding. Deliberately tiny — we control both ends and only need
// CONNECT, so we avoid pulling in an unmaintained SOCKS-server dependency.
export function runSocks5Server(options: Socks5ServerOptions): Promise<() => Promise<void>> {
  const server = net.createServer((socket) => {
    handleSocksClient(socket, options.connect);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.bindAddress, () => {
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

function handleSocksClient(
  socket: net.Socket,
  connect: (host: string, port: number) => Promise<ClientChannel>,
): void {
  let stage: "greeting" | "request" | "connected" = "greeting";
  let buffer = Buffer.alloc(0);

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    if (stage === "greeting") {
      if (buffer.length < 2) {
        return;
      }
      const methodCount = buffer[1] ?? 0;
      if (buffer.length < 2 + methodCount) {
        return;
      }
      buffer = buffer.subarray(2 + methodCount);
      // Reply: version 5, no-auth (0x00).
      socket.write(Buffer.from([0x05, 0x00]));
      stage = "request";
    }
    if (stage === "request") {
      const parsed = parseConnectRequest(buffer);
      if (!parsed) {
        return;
      }
      stage = "connected";
      socket.removeListener("data", onData);
      void openTunnel(socket, parsed.host, parsed.port, connect);
    }
  };
  socket.on("data", onData);
  socket.on("error", () => socket.destroy());
}

interface ConnectRequest {
  host: string;
  port: number;
}

// Parses a SOCKS5 CONNECT request; returns null while bytes are still pending.
function parseConnectRequest(buffer: Buffer): ConnectRequest | null {
  if (buffer.length < 4) {
    return null;
  }
  const command = buffer[1];
  const addressType = buffer[3];
  if (command !== 0x01) {
    return null; // only CONNECT
  }
  if (addressType === 0x01) {
    if (buffer.length < 10) {
      return null;
    }
    const host = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
    const port = buffer.readUInt16BE(8);
    return { host, port };
  }
  if (addressType === 0x03) {
    const len = buffer[4] ?? 0;
    if (buffer.length < 5 + len + 2) {
      return null;
    }
    const host = buffer.subarray(5, 5 + len).toString("utf8");
    const port = buffer.readUInt16BE(5 + len);
    return { host, port };
  }
  if (addressType === 0x04) {
    if (buffer.length < 22) {
      return null;
    }
    const host = buffer
      .subarray(4, 20)
      .toString("hex")
      .replace(/(.{4})/g, "$1:")
      .slice(0, -1);
    const port = buffer.readUInt16BE(20);
    return { host, port };
  }
  return null;
}

async function openTunnel(
  socket: net.Socket,
  host: string,
  port: number,
  connect: (host: string, port: number) => Promise<ClientChannel>,
): Promise<void> {
  try {
    const channel = await connect(host, port);
    // Success reply (bound address 0.0.0.0:0 — clients ignore it for CONNECT).
    socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    socket.pipe(channel).pipe(socket);
    socket.on("error", () => channel.close());
    channel.on("error", () => socket.destroy());
  } catch {
    // General failure reply.
    socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    socket.destroy();
  }
}
