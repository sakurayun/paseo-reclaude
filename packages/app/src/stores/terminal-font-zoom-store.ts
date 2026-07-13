import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const TERMINAL_MIN_FONT_SIZE = 6;
export const TERMINAL_MAX_FONT_SIZE = 40;

// Effective terminal font size: the shared codeFontSize setting plus this
// device's zoom offset (Ctrl+± / Ctrl+wheel), clamped to a renderable range.
export function applyTerminalFontZoom(baseFontSize: number, fontSizeDelta: number): number {
  const next = Math.round(baseFontSize + fontSizeDelta);
  return Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, next));
}

interface TerminalFontZoomState {
  fontSizeDelta: number;
  zoomBy: (steps: number, baseFontSize: number) => void;
  resetZoom: () => void;
}

// Device-local (deliberately not part of the synced appearance settings):
// zoom is a per-device ergonomic adjustment layered over codeFontSize, shared
// by every terminal pane on this device and persisted across reloads.
export const useTerminalFontZoomStore = create<TerminalFontZoomState>()(
  persist(
    (set) => ({
      fontSizeDelta: 0,
      zoomBy: (steps, baseFontSize) =>
        set((state) => ({
          fontSizeDelta:
            applyTerminalFontZoom(baseFontSize, state.fontSizeDelta + steps) - baseFontSize,
        })),
      resetZoom: () => set({ fontSizeDelta: 0 }),
    }),
    {
      name: "terminal-font-zoom",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ fontSizeDelta: state.fontSizeDelta }),
    },
  ),
);
