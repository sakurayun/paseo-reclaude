// See ssh-key-store.ts: ssh2 is CJS with dynamic named exports, so `Client`
// must come off the default import to load under native ESM (Electron), not
// just tsx/vitest. Type-only imports are erased and stay named.
import ssh2, {
  type ClientChannel,
  type ConnectConfig,
  type PseudoTtyOptions,
  type SFTPWrapper,
} from "ssh2";

const { Client } = ssh2;

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// Raised when ssh2 exhausts authentication (wrong password / rejected key), so
// callers can offer an inline password retry rather than a generic error.
export class SshAuthFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshAuthFailedError";
  }
}

// Thin wrapper around a single ssh2 Client. Owns the connection lifecycle and
// exposes the operations the SSH manager needs: an interactive shell, one-shot
// exec (platform detection), and forwardOut (host chaining / -L forwarding).
export class SshConnection {
  private readonly client = new Client();
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  connect(config: ConnectConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = (): void => {
        this.client.removeListener("error", onError);
        resolve();
      };
      const onError = (error: Error): void => {
        this.client.removeListener("ready", onReady);
        // ssh2 tags auth exhaustion with level "client-authentication".
        if ((error as { level?: string }).level === "client-authentication") {
          reject(new SshAuthFailedError(error.message));
          return;
        }
        reject(error);
      };
      this.client.once("ready", onReady);
      this.client.once("error", onError);
      this.client.on("close", () => {
        this.closed = true;
        for (const listener of this.closeListeners) {
          listener();
        }
      });
      this.client.connect(config);
    });
  }

  shell(options: {
    cols: number;
    rows: number;
    env?: Record<string, string>;
  }): Promise<ClientChannel> {
    const window: PseudoTtyOptions = {
      term: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
    };
    return new Promise((resolve, reject) => {
      this.client.shell(window, options.env ? { env: options.env } : {}, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(channel);
      });
    });
  }

  // Opens an SFTP subsystem channel on this connection — the transport for
  // drag-drop uploads. Callers own the returned wrapper's lifecycle; closing
  // it does not close the underlying connection.
  sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(sftp);
      });
    });
  }

  exec(command: string): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        let stdout = "";
        let stderr = "";
        let code: number | null = null;
        channel.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        channel.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        channel.on("exit", (exitCode: number | null) => {
          code = exitCode;
        });
        channel.on("close", () => resolve({ stdout, stderr, code }));
      });
    });
  }

  // Opens a direct-tcpip channel through this connection — the building block
  // for ProxyJump host chaining and local (-L) port forwarding.
  forwardOut(
    srcHost: string,
    srcPort: number,
    dstHost: string,
    dstPort: number,
  ): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client.forwardOut(srcHost, srcPort, dstHost, dstPort, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(channel);
      });
    });
  }

  // Asks the server to listen on bindAddr:port and forward incoming connections
  // back over this client — the building block for remote (-R) forwarding.
  forwardIn(bindAddr: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.client.forwardIn(bindAddr, port, (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(boundPort ?? port);
      });
    });
  }

  unforwardIn(bindAddr: string, port: number): void {
    this.client.unforwardIn(bindAddr, port, () => {});
  }

  // Fires for each remote (-R) connection the server pushes back.
  onTcpConnection(
    listener: (info: { destPort: number }, accept: () => ClientChannel, reject: () => void) => void,
  ): () => void {
    const handler = (
      info: { destPort: number },
      accept: () => ClientChannel,
      rejectConn: () => void,
    ): void => listener(info, accept, rejectConn);
    this.client.on("tcp connection", handler);
    return () => {
      this.client.removeListener("tcp connection", handler);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.client.end();
  }
}
