import type { Theme } from "@/styles/theme";

// The full terminal palette shape (background/foreground/cursor/selection + the
// 16-color ANSI set) is owned by the theme. A preset must supply every field;
// the `Record<…, TerminalPalette>` annotation below makes a missing field a
// compile error.
type TerminalPalette = Theme["colors"]["terminal"];

// A user-selectable terminal color scheme. "auto" is special: it keeps the
// current behavior of following the app theme's own terminal palette, and is
// therefore NOT a key in `TERMINAL_COLOR_PRESETS` — it resolves to the live
// `theme.colors.terminal` at render time (see `resolveTerminalPalette`).
//
// Why this exists: shells with oh-my-zsh / Starship / Powerlevel10k emit fixed
// ANSI colors. When the active app theme's palette has poor contrast against
// those, prompt text becomes unreadable. Picking a battle-tested scheme (or the
// explicit High Contrast options) fixes legibility independent of the UI theme.
export type TerminalColorSchemeId =
  | "auto"
  | "oneDark"
  | "dracula"
  | "solarizedDark"
  | "gruvboxDark"
  | "nord"
  | "monokai"
  | "catppuccinMocha"
  | "solarizedLight"
  | "githubLight"
  | "highContrastDark"
  | "highContrastLight";

// Eleven concrete palettes keyed by scheme id. Colors follow each scheme's
// published/community-canonical values. Where a scheme does not define a cursor
// or selection color, cursor defaults to the foreground and selection to a muted
// surface tone — both chosen to stay legible.
export const TERMINAL_COLOR_PRESETS: Record<
  Exclude<TerminalColorSchemeId, "auto">,
  TerminalPalette
> = {
  oneDark: {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    selectionForeground: "#abb2bf",

    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",

    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    selectionForeground: "#f8f8f2",

    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",

    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  solarizedDark: {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "#073642",
    selectionForeground: "#93a1a1",

    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",

    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  gruvboxDark: {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#504945",
    selectionForeground: "#ebdbb2",

    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",

    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
  nord: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    selectionForeground: "#eceff4",

    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",

    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  monokai: {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "#49483e",
    selectionForeground: "#f8f8f2",

    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#f4bf75",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",

    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
  },
  catppuccinMocha: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#585b70",
    selectionForeground: "#cdd6f4",

    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",

    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  solarizedLight: {
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#586e75",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#eee8d5",
    selectionForeground: "#586e75",

    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",

    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  githubLight: {
    background: "#ffffff",
    foreground: "#24292e",
    cursor: "#24292e",
    cursorAccent: "#ffffff",
    selectionBackground: "#c8e1ff",
    selectionForeground: "#24292e",

    black: "#24292e",
    red: "#d73a49",
    green: "#28a745",
    yellow: "#dbab09",
    blue: "#0366d6",
    magenta: "#5a32a3",
    cyan: "#0598bc",
    white: "#6a737d",

    brightBlack: "#959da5",
    brightRed: "#cb2431",
    brightGreen: "#22863a",
    brightYellow: "#b08800",
    brightBlue: "#005cc5",
    brightMagenta: "#5a32a3",
    brightCyan: "#3192aa",
    brightWhite: "#d1d5da",
  },
  // Pure black background, pure white foreground, max-saturation ANSI. The
  // "I literally can't read it — fix it now" option. `blue` is deliberately
  // #3b82f6 rather than pure #0000ff, which is illegibly dark on black.
  highContrastDark: {
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#3a3aff",
    selectionForeground: "#ffffff",

    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#3b82f6",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",

    brightBlack: "#808080",
    brightRed: "#ff5555",
    brightGreen: "#55ff55",
    brightYellow: "#ffff55",
    brightBlue: "#5c9dff",
    brightMagenta: "#ff55ff",
    brightCyan: "#55ffff",
    brightWhite: "#ffffff",
  },
  // Pure white background, pure black foreground, darkened ANSI for AAA contrast.
  highContrastLight: {
    background: "#ffffff",
    foreground: "#000000",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selectionBackground: "#b3d4fc",
    selectionForeground: "#000000",

    black: "#000000",
    red: "#b00000",
    green: "#006600",
    yellow: "#7a5c00",
    blue: "#0000cc",
    magenta: "#990099",
    cyan: "#006699",
    white: "#000000",

    brightBlack: "#555555",
    brightRed: "#cc0000",
    brightGreen: "#007700",
    brightYellow: "#8a6d00",
    brightBlue: "#0000ee",
    brightMagenta: "#bb00bb",
    brightCyan: "#0077aa",
    brightWhite: "#000000",
  },
};

// Display + validation order: "auto" first, then dark schemes, light schemes,
// and the two explicit High Contrast options last. Used both as the dropdown
// order and as the source of valid ids for settings validation.
export const TERMINAL_COLOR_SCHEME_IDS: readonly TerminalColorSchemeId[] = [
  "auto",
  "oneDark",
  "dracula",
  "solarizedDark",
  "gruvboxDark",
  "nord",
  "monokai",
  "catppuccinMocha",
  "solarizedLight",
  "githubLight",
  "highContrastDark",
  "highContrastLight",
];

export const VALID_TERMINAL_COLOR_SCHEMES = new Set<string>(TERMINAL_COLOR_SCHEME_IDS);

// Resolve a scheme to a concrete palette. "auto" (and any unexpected id) falls
// back to the theme's own terminal palette, preserving the pre-feature behavior.
export function resolveTerminalPalette(
  scheme: TerminalColorSchemeId,
  themeDefault: TerminalPalette,
): TerminalPalette {
  if (scheme === "auto") {
    return themeDefault;
  }
  return TERMINAL_COLOR_PRESETS[scheme] ?? themeDefault;
}
