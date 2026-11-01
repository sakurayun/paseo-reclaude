import { describe, expect, it, vi } from "vitest";

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class ClipboardAddon {
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddon {
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class ImageAddon {
    // 接受运行时传入的插件选项。
    readonly options: unknown;
    constructor(...args: unknown[]) {
      this.options = args[0];
    }
    dispose(): void {}
    getImageAtBufferCell(): undefined {
      return undefined;
    }
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class SearchAddon {
    findNext(): boolean {
      return false;
    }
    findPrevious(): boolean {
      return false;
    }
    clearDecorations(): void {}
    onDidChangeResults(): { dispose: () => void } {
      return { dispose: () => {} };
    }
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class Unicode11Addon {
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: class UnicodeGraphemesAddon {
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class WebLinksAddon {
    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon {
    onContextLoss(): void {}
    dispose(): void {}
  },
}));

const terminalConstructorOptions = vi.hoisted(() => ({
  values: [] as unknown[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class Terminal {
    rows = 24;
    cols = 80;
    unicode = { activeVersion: "" };
    parser = {
      registerCsiHandler: () => undefined,
    };
    element = { style: { fontFeatureSettings: "" } };
    constructor(options: unknown) {
      terminalConstructorOptions.values.push(options);
    }
    loadAddon(): void {}
    registerLinkProvider(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    registerCharacterJoiner(): number {
      return 1;
    }
    deregisterCharacterJoiner(): void {}
    open(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
    attachCustomKeyEventHandler(): void {}
    dispose(): void {}
    refresh(): void {}
  },
}));

import { encodeTerminalOutput, TerminalEmulatorRuntime } from "./terminal-emulator-runtime";

function createNotificationRuntime() {
  const runtime = new TerminalEmulatorRuntime();
  const onInput = vi.fn();
  const onDesktopNotification = vi.fn();
  const onProgressChange = vi.fn();
  const handlers = new Map<number, (data: string) => boolean>();
  const commits: Array<() => void> = [];
  const terminal = {
    parser: {
      registerOscHandler(code: number, handler: (data: string) => boolean) {
        handlers.set(code, handler);
        return { dispose() {} };
      },
    },
    write(data: Uint8Array, committed?: () => void) {
      const text = new TextDecoder().decode(data);
      for (const sequence of text.split("\x1b]").slice(1)) {
        const payload = sequence.split("\x07")[0];
        const separator = payload.indexOf(";");
        handlers.get(Number(payload.slice(0, separator)))?.(payload.slice(separator + 1));
      }
      if (committed) commits.push(committed);
    },
  };
  const internals = runtime as unknown as {
    terminal: typeof terminal;
    setupKittyProtocolHandlers(terminalInstance: typeof terminal): () => void;
  };
  internals.terminal = terminal;
  internals.setupKittyProtocolHandlers(terminal);
  runtime.setCallbacks({ callbacks: { onInput, onDesktopNotification, onProgressChange } });
  return {
    runtime,
    onInput,
    onDesktopNotification,
    onProgressChange,
    commit: () => commits.shift()?.(),
  };
}

describe("terminal notification replay", () => {
  it("suppresses notification and capability side effects until replay writes commit", async () => {
    const test = createNotificationRuntime();
    test.runtime.replay({ type: "begin" });
    test.commit();
    test.runtime.replay({
      type: "data",
      data: encodeTerminalOutput(
        "\x1b]99;i=probe:p=?;\x07\x1b]99;i=old;Old notification\x07\x1b]9;Legacy notification\x07",
      ),
    });
    test.runtime.replay({ type: "end" });
    expect(test.onInput).not.toHaveBeenCalled();
    expect(test.onDesktopNotification).not.toHaveBeenCalled();
    test.commit();
    await Promise.resolve();
    test.runtime.write({
      data: encodeTerminalOutput("\x1b]99;i=live:p=?;\x07\x1b]9;Live notification\x07"),
    });
    test.commit();
    expect(test.onInput).toHaveBeenCalledTimes(1);
    expect(test.onDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Live notification" }),
    );
  });

  it("does not combine a replayed notification title with a later live body", () => {
    const test = createNotificationRuntime();
    test.runtime.write({
      data: encodeTerminalOutput("\x1b]99;i=shared:d=0;Old title\x07"),
      suppressInput: true,
    });
    test.commit();
    test.runtime.write({ data: encodeTerminalOutput("\x1b]99;i=shared:p=body;Live body\x07") });
    test.commit();
    expect(test.onDesktopNotification).toHaveBeenCalledTimes(1);
    expect(test.onDesktopNotification.mock.calls[0][0].title).not.toBe("Old title");
  });

  it("still restores progress state while suppressing legacy notification delivery", () => {
    const test = createNotificationRuntime();
    test.runtime.write({
      data: encodeTerminalOutput("\x1b]9;4;1;42\x07\x1b]9;Old notification\x07"),
      suppressInput: true,
    });
    test.commit();
    expect(test.onProgressChange).toHaveBeenCalledTimes(1);
    expect(test.onDesktopNotification).not.toHaveBeenCalled();
  });
});
