import { EventEmitter } from "node:events";
import type { ClientChannel } from "ssh2";
import { describe, expect, it } from "vitest";

import { createSshTerminalBackend } from "./ssh-terminal-backend.js";

// Minimal stand-in for an ssh2 ClientChannel: an EventEmitter with write /
// setWindow / close plus a separate stderr emitter.
class FakeChannel extends EventEmitter {
  written: Array<string | Buffer> = [];
  window: { rows: number; cols: number } | null = null;
  closed = false;
  readonly stderr = new EventEmitter();

  write(data: string | Buffer): boolean {
    this.written.push(data);
    return true;
  }

  setWindow(rows: number, cols: number): void {
    this.window = { rows, cols };
  }

  close(): void {
    this.closed = true;
    this.emit("close");
  }
}

function makeBackend(overrides?: { charset?: string; backspaceMode?: "del" | "ctrl-h" }) {
  const channel = new FakeChannel();
  let closedCalls = 0;
  const backend = createSshTerminalBackend({
    channel: channel as unknown as ClientChannel,
    charset: overrides?.charset ?? "utf-8",
    backspaceMode: overrides?.backspaceMode ?? "del",
    onClosed: () => {
      closedCalls += 1;
    },
  });
  return { channel, backend, closedCalls: () => closedCalls };
}

describe("createSshTerminalBackend", () => {
  it("forwards channel data (stdout + stderr) to the data listener", () => {
    const { channel, backend } = makeBackend();
    const received: string[] = [];
    backend.onData((data) => received.push(data));

    channel.emit("data", Buffer.from("hello"));
    channel.stderr.emit("data", Buffer.from("oops"));
    expect(received).toEqual(["hello", "oops"]);
  });

  it("maps resize to ssh2 setWindow(rows, cols)", () => {
    const { channel, backend } = makeBackend();
    backend.resize(120, 40);
    expect(channel.window).toEqual({ rows: 40, cols: 120 });
  });

  it("rewrites DEL to Ctrl-H only in ctrl-h backspace mode", () => {
    const del = makeBackend({ backspaceMode: "del" });
    del.backend.write("a\x7fb");
    expect(del.channel.written).toEqual(["a\x7fb"]);

    const ctrlH = makeBackend({ backspaceMode: "ctrl-h" });
    ctrlH.backend.write("a\x7fb");
    expect(ctrlH.channel.written).toEqual(["a\bb"]);
  });

  it("emits exit with the reported code and calls onClosed once", () => {
    const { channel, backend, closedCalls } = makeBackend();
    const exits: Array<{ exitCode: number | null; signal: number | null }> = [];
    backend.onExit((event) => exits.push(event));

    channel.emit("exit", 0);
    channel.close();
    // A second close must not double-report.
    channel.emit("close");

    expect(exits).toEqual([{ exitCode: 0, signal: null }]);
    expect(closedCalls()).toBe(1);
  });

  it("reports a signalled exit as a nonzero signal marker", () => {
    const { channel, backend } = makeBackend();
    const exits: Array<{ exitCode: number | null; signal: number | null }> = [];
    backend.onExit((event) => exits.push(event));

    channel.emit("exit", null, "SIGKILL");
    channel.close();
    expect(exits[0]?.signal).toBe(9);
  });

  it("transcodes non-utf8 charsets across split multibyte chunks", () => {
    const { channel, backend } = makeBackend({ charset: "gbk" });
    const received: string[] = [];
    backend.onData((data) => received.push(data));

    // "中文" in GBK is D6 D0 CE C4. Split the first character across two chunks
    // to exercise the stateful decoder.
    channel.emit("data", Buffer.from([0xd6]));
    channel.emit("data", Buffer.from([0xd0, 0xce, 0xc4]));
    expect(received.join("")).toBe("中文");
  });
});
