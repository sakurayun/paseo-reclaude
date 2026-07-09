import iconv from "iconv-lite";
import type { ClientChannel } from "ssh2";

import type { TerminalBackend, TerminalBackendExitEvent } from "../terminal/terminal.js";

export interface SshTerminalBackendInput {
  channel: ClientChannel;
  charset: string;
  backspaceMode: "del" | "ctrl-h";
  // Called once the channel closes so the connection pool can drop its
  // reference to the underlying ssh2 Client.
  onClosed?: () => void;
}

// Bridges an ssh2 shell channel to the terminal session pipeline. Handles
// charset transcoding (stateful, so multibyte sequences split across packets
// stay intact) and optional Backspace key remapping.
export function createSshTerminalBackend(input: SshTerminalBackendInput): TerminalBackend {
  const { channel, backspaceMode } = input;
  const passthrough = isUtf8(input.charset);
  const decoder = passthrough ? null : iconv.getDecoder(input.charset);
  const encoder = passthrough ? null : iconv.getEncoder(input.charset);

  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: TerminalBackendExitEvent) => void) | null = null;
  let exitCode: number | null = null;
  let exitSignal: number | null = null;
  let exitReported = false;

  function emitData(chunk: Buffer): void {
    if (!dataListener) {
      return;
    }
    dataListener(decoder ? decoder.write(chunk) : chunk.toString("utf8"));
  }

  function reportExit(): void {
    if (exitReported) {
      return;
    }
    exitReported = true;
    input.onClosed?.();
    exitListener?.({ exitCode, signal: exitSignal });
  }

  channel.on("data", (chunk: Buffer) => emitData(chunk));
  channel.stderr?.on("data", (chunk: Buffer) => emitData(chunk));
  // ssh2 emits `exit` with either an exit code or a signal name before `close`.
  channel.on("exit", (code: number | null, signalName?: string | null) => {
    if (typeof code === "number") {
      exitCode = code;
    }
    if (typeof signalName === "string") {
      // Map to a nonzero marker; callers only distinguish "signalled" vs clean.
      exitSignal = signalToNumber(signalName);
    }
  });
  channel.on("close", () => reportExit());

  return {
    write(data: string): void {
      const remapped = backspaceMode === "ctrl-h" ? data.replace(/\x7f/g, "\b") : data;
      channel.write(encoder ? encoder.write(remapped) : remapped);
    },
    resize(cols: number, rows: number): void {
      // ssh2 signature: setWindow(rows, cols, height, width).
      channel.setWindow(rows, cols, 0, 0);
    },
    kill(): void {
      channel.close();
    },
    onData(listener: (data: string) => void): void {
      dataListener = listener;
    },
    onExit(listener: (event: TerminalBackendExitEvent) => void): void {
      exitListener = listener;
      if (exitReported) {
        listener({ exitCode, signal: exitSignal });
      }
    },
    // The channel is already open by the time it's handed to the backend.
    waitForStart(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function isUtf8(charset: string): boolean {
  const normalized = charset.toLowerCase().replace(/[-_]/g, "");
  return normalized === "utf8" || normalized === "utf";
}

// Best-effort POSIX signal name → number. Only used as a nonzero "was
// signalled" marker in the exit event, so an approximate table is fine.
function signalToNumber(signalName: string): number {
  const table: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGABRT: 6,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGSEGV: 11,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
  };
  return table[signalName] ?? 1;
}
