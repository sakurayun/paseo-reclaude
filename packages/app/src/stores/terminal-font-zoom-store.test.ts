import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import {
  applyTerminalFontZoom,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
  useTerminalFontZoomStore,
} from "./terminal-font-zoom-store";

describe("applyTerminalFontZoom", () => {
  it("adds the delta and clamps to the renderable range", () => {
    expect(applyTerminalFontZoom(13, 0)).toBe(13);
    expect(applyTerminalFontZoom(13, 3)).toBe(16);
    expect(applyTerminalFontZoom(13, -100)).toBe(TERMINAL_MIN_FONT_SIZE);
    expect(applyTerminalFontZoom(13, 100)).toBe(TERMINAL_MAX_FONT_SIZE);
  });
});

describe("useTerminalFontZoomStore", () => {
  it("steps the delta, saturates at the clamp, and resets", () => {
    const store = useTerminalFontZoomStore.getState();
    store.resetZoom();

    useTerminalFontZoomStore.getState().zoomBy(2, 13);
    expect(useTerminalFontZoomStore.getState().fontSizeDelta).toBe(2);

    // Zooming far past the max saturates the delta instead of growing it
    // unbounded — one zoom-out immediately steps back down.
    useTerminalFontZoomStore.getState().zoomBy(100, 13);
    expect(applyTerminalFontZoom(13, useTerminalFontZoomStore.getState().fontSizeDelta)).toBe(
      TERMINAL_MAX_FONT_SIZE,
    );
    useTerminalFontZoomStore.getState().zoomBy(-1, 13);
    expect(applyTerminalFontZoom(13, useTerminalFontZoomStore.getState().fontSizeDelta)).toBe(
      TERMINAL_MAX_FONT_SIZE - 1,
    );

    useTerminalFontZoomStore.getState().resetZoom();
    expect(useTerminalFontZoomStore.getState().fontSizeDelta).toBe(0);
  });
});
