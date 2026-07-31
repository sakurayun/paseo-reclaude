// Keep this module free of @xterm and DOM-only runtime imports.
// Native paths (terminal-pane → panels → workspace route) must be able to
// read font defaults without evaluating terminal-emulator-runtime, which
// pulls WebAssembly via @xterm and crashes Hermes.

export const DEFAULT_TERMINAL_FONT_SIZE = 13;

export type TerminalFontZoomDirection = "in" | "out" | "reset";
