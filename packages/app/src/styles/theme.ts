import { Platform } from "react-native";
import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";

export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
  },

  // Purple scale
  purple: {
    500: "#a855f7",
    600: "#9333ea",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

export type ThemeName =
  | "light"
  | "claudeLight"
  | "catppuccinLatte"
  | "dark"
  | "zinc"
  | "midnight"
  | "claude"
  | "ghostty"
  | "catppuccinFrappe"
  | "catppuccinMacchiato"
  | "catppuccinMocha";

// Diff stat colors — light uses muted tones, dark uses the brighter palette values
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors — semantic signals for success/danger/warning/merged. Used by
// check statuses, PR states, and review decisions. Kept a step darker than the
// raw palette so they read as signals, not neon.
const lightStatusColors = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  statusMerged: "#7c3aed", // purple-600
  statusPlanning: "#0e7490", // cyan-700
};

const darkStatusColors = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  statusMerged: "#9333ea", // purple-600
  statusPlanning: "#06b6d4", // cyan-500
};

// Glass tints are precomputed here because Unistyles serves theme colors as
// CSS variables on web — runtime hex parsing would see "var(--…)" and fail.
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Semantic color tokens - Layer-based system
const lightSemanticColors = {
  // Surfaces (layers) - shifted one step lighter
  surface0: "#ffffff", // App background
  surface1: "#fafafa", // Subtle hover (was zinc-100, now zinc-50)
  surface2: "#f4f4f5", // Elevated: badges, inputs, sheets (was zinc-200, now zinc-100)
  surface3: "#e4e4e7", // Highest elevation (was zinc-300, now zinc-200)
  surface4: "#d4d4d8", // Extra emphasis (was zinc-400, now zinc-300)
  surfaceDiffEmpty: "#f6f6f6", // Empty side of split diff rows, between surface1 and surface2 and biased toward surface2
  surfaceSidebar: "#f4f4f5", // Sidebar background (darker than main)
  surfaceSidebarHover: "#e9e9ec", // Sidebar hover (darker in light mode)
  surfaceWorkspace: "#ffffff", // Workspace main background
  surfaceShell: "#ffffff", // Shell underlay + exposed-header surface (= surface0 in classic)
  surfaceGlass: withAlpha("#fafafa", 0.62), // Frosted composer (web, behind backdrop blur)
  surfaceGlassStrong: withAlpha("#fafafa", 0.94), // Dense glass fallback for non-blurred surfaces

  // Text
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  foregroundExtraMuted: "#a1a1aa",

  // Controls
  scrollbarHandle: "#3f3f46", // zinc-700

  // Borders - shifted one step lighter
  border: "#e4e4e7", // (was zinc-200, now zinc-200 - keep for contrast)
  borderAccent: "#ececf1", // Softer accent border for low-emphasis outlines

  // Brand
  accent: "#20744A",
  accentBright: "#239956",
  accentForeground: "#ffffff",

  // Ultracode composer glow
  ultracodeGlow: {
    border: "#c4b5fd",
    halo: "#a78bfa",
  },

  // Semantic
  destructive: "#b04138", // dark warm red on white — calm but unambiguously red
  destructiveForeground: "#ffffff",
  success: "#20744A",
  successForeground: "#ffffff",

  // Legacy aliases (for gradual migration)
  background: "#ffffff",
  popover: "#ffffff",
  popoverForeground: "#1a1a1e",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  secondary: "#f4f4f5",
  secondaryForeground: "#1a1a1e",
  muted: "#f4f4f5",
  mutedForeground: "#71717a",
  accentBorder: "#ececf1",
  input: "#f4f4f5",
  ring: "#18181b",

  ...lightDiffColors,
  ...lightStatusColors,

  terminal: {
    background: "#ffffff",
    foreground: "#1a1a1e",
    cursor: "#1a1a1e",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.15)",
    selectionForeground: "#1a1a1e",

    black: "#1a1a1e",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#ffffff",

    brightBlack: "#3f3f46",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#fafafa",
  },
} as const;

// Claude light — warm ivory surfaces with the Claude terracotta accent,
// mirroring claude.ai's light interface.
const claudeLightSemanticColors = {
  // Surfaces (layers) — warm ivory ramp
  surface0: "#faf9f5", // App background (ivory)
  surface1: "#f5f4ee", // Subtle hover
  surface2: "#f0eee6", // Elevated: badges, inputs, sheets (cream)
  surface3: "#e3e0d5", // Highest elevation
  surface4: "#d1cdc0", // Extra emphasis
  surfaceDiffEmpty: "#f2f1e9", // Empty side of split diff rows
  surfaceSidebar: "#f0eee6", // Sidebar background (darker than main)
  surfaceSidebarHover: "#e6e3d8", // Sidebar hover
  surfaceWorkspace: "#faf9f5", // Workspace main background
  surfaceShell: "#faf9f5", // Shell underlay + exposed-header surface (= surface0 in classic)
  surfaceGlass: withAlpha("#f5f4ee", 0.62), // Frosted composer (web, behind backdrop blur)
  surfaceGlassStrong: withAlpha("#f5f4ee", 0.94), // Dense glass fallback for non-blurred surfaces

  // Text — warm near-black
  foreground: "#1f1e1d",
  foregroundMuted: "#87867f",
  foregroundExtraMuted: "#b7b6af",

  // Controls
  scrollbarHandle: "#56544e",

  // Borders — warm stone
  border: "#e3e0d5",
  borderAccent: "#eceadf",

  // Brand — Claude terracotta, deepened a step for light surfaces
  accent: "#c96442",
  accentBright: "#d97757",
  accentForeground: "#ffffff",

  // Ultracode composer glow — terracotta instead of the default violet
  ultracodeGlow: {
    border: "#e0a285",
    halo: "#d97757",
  },

  // Semantic
  destructive: "#ab3a2e", // warm red that sits with the terracotta accent
  destructiveForeground: "#ffffff",
  success: "#20744A",
  successForeground: "#ffffff",

  // Legacy aliases (for gradual migration)
  background: "#faf9f5",
  popover: "#faf9f5",
  popoverForeground: "#1f1e1d",
  primary: "#1f1e1d",
  primaryForeground: "#faf9f5",
  secondary: "#f0eee6",
  secondaryForeground: "#1f1e1d",
  muted: "#f0eee6",
  mutedForeground: "#87867f",
  accentBorder: "#eceadf",
  input: "#f0eee6",
  ring: "#1f1e1d",

  ...lightDiffColors,
  ...lightStatusColors,

  terminal: {
    background: "#faf9f5",
    foreground: "#1f1e1d",
    cursor: "#1f1e1d",
    cursorAccent: "#faf9f5",
    selectionBackground: "rgba(0, 0, 0, 0.15)",
    selectionForeground: "#1f1e1d",

    black: "#1f1e1d",
    red: "#c0392b",
    green: "#16a34a",
    yellow: "#b8860b",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#faf9f5",

    brightBlack: "#56544e",
    brightRed: "#e74c3c",
    brightGreen: "#22c55e",
    brightYellow: "#d4a017",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  },
} as const;

// New theme — redesigned floating UI (always on; classic chrome retired).
// Light + dark variants share the same shell layout tokens (floating card,
// no chrome dividers, borderless controls); only the palette differs.
// Derived from classic light/zinc-dark so every token inherits by default —
// grow the redesign by adding overrides here (colors) or on `newThemeShell`.
const newThemeSemanticColors = {
  ...lightSemanticColors,
  // All non-content sidebar/chrome surfaces sit on a near-white #fafafa, one
  // hair off the #ffffff main content area for a quiet, modern separation.
  surfaceSidebar: "#fafafa",
  // The shell underlay (behind the floating content card) is the same #fafafa,
  // so sidebars + the margins around the card read as one continuous backdrop.
  surfaceShell: "#fafafa",
  // Scrollbar handle is #fafafa too, so the native + overlay scrollbars melt
  // into the #fafafa chrome instead of cutting a darker bar across it. Both the
  // CSS scrollbar (use-web-scrollbar-style.web.ts) and the desktop overlay
  // (web-desktop-scrollbar.tsx) read this token, so the new theme owns both.
  scrollbarHandle: "#fafafa",
} as const;

// ---------------------------------------------------------------------------
// Dark theme variant builder
// ---------------------------------------------------------------------------

interface DarkThemeConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground?: string;
  destructive: string;
  ultracodeGlow?: { border: string; halo: string };
}

const darkTerminalAnsi = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#b07ad0",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#c49ae0",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

function buildDarkSemanticColors(tint: DarkThemeConfig) {
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface1,
    surfaceShell: tint.surface0, // Shell underlay + exposed-header surface (= surface0 in classic)
    surfaceGlass: withAlpha(tint.surface1, 0.62),
    surfaceGlassStrong: withAlpha(tint.surface1, 0.94),

    foreground: "#fafafa",
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,

    scrollbarHandle: tint.scrollbarHandle,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: tint.accentForeground ?? "#ffffff",

    ultracodeGlow: tint.ultracodeGlow ?? {
      border: "#c4b5fd",
      halo: "#a78bfa",
    },

    destructive: tint.destructive,
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: "#fafafa",
    primary: "#fafafa",
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: "#fafafa",
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: "#d4d4d8",

    ...darkDiffColors,
    ...darkStatusColors,

    terminal: {
      background: tint.surface0,
      foreground: "#fafafa",
      cursor: "#fafafa",
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: "#fafafa",
      black: tint.surfaceSidebar,
      ...darkTerminalAnsi,
      brightBlack: tint.surface3,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions
// ---------------------------------------------------------------------------

// Paseo — subtle teal-green tint (default)
const paseoDarkColors = buildDarkSemanticColors({
  surface0: "#181B1A",
  surface1: "#1E2120",
  surface2: "#272A29",
  surface3: "#434645",
  surface4: "#595B5B",
  surfaceDiffEmpty: "#252827",
  surfaceSidebar: "#141716",
  surfaceSidebarHover: "#1c1f1e",
  foregroundMuted: "#A1A5A4",
  foregroundExtraMuted: "#717574",
  scrollbarHandle: "#717574",
  border: "#252B2A",
  borderAccent: "#2F3534",
  accent: "#20744A",
  accentBright: "#7ccba0",
  destructive: "#c64f43", // warm red, hue ~7 — reads as red (not pink) against the green tint
});

// Zinc — neutral gray, no tint
const zincDarkColors = buildDarkSemanticColors({
  surface0: "#18181b",
  surface1: "#1f1f22",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#242427",
  surfaceSidebar: "#131316",
  surfaceSidebarHover: "#1b1b1e",
  foregroundMuted: "#a1a1aa",
  foregroundExtraMuted: "#71717a",
  scrollbarHandle: "#71717a",
  border: "#27272a",
  borderAccent: "#303036",
  accent: "#e4e4e7",
  accentBright: "#fafafa",
  accentForeground: "#18181b", // monochrome zinc accent is near-white — needs dark text
  destructive: "#c44a4a", // neutral red, hue 0 — clearly red without screaming
});

// Midnight — subtle blue tint
const midnightDarkColors = buildDarkSemanticColors({
  surface0: "#161820",
  surface1: "#1c1e27",
  surface2: "#252731",
  surface3: "#3c3e4c",
  surface4: "#535564",
  surfaceDiffEmpty: "#222430",
  surfaceSidebar: "#121420",
  surfaceSidebarHover: "#1a1c28",
  foregroundMuted: "#9a9db0",
  foregroundExtraMuted: "#6b6e82",
  scrollbarHandle: "#6b6e82",
  border: "#242636",
  borderAccent: "#2e3040",
  accent: "#3b6fcf",
  accentBright: "#7eaaeb",
  destructive: "#c44a52", // red with a hint of cool lean against the blue tint
});

// Claude — warm neutral with subtle orange undertone
const claudeDarkColors = buildDarkSemanticColors({
  surface0: "#1f1f1e",
  surface1: "#262523",
  surface2: "#2f2d2b",
  surface3: "#4a4745",
  surface4: "#605d5b",
  surfaceDiffEmpty: "#2a2826",
  surfaceSidebar: "#1a1918",
  surfaceSidebarHover: "#222120",
  foregroundMuted: "#ada9a5",
  foregroundExtraMuted: "#78746f",
  scrollbarHandle: "#78746f",
  border: "#2c2a27",
  borderAccent: "#36332f",
  accent: "#d97757",
  accentBright: "#e89a7f",
  destructive: "#cf513e", // warm orange-red, hue ~10 — sits with the Claude orange accent
  ultracodeGlow: { border: "#c97c5d", halo: "#d97757" },
});

// Ghostty — blue-tinted dark based on Ghostty default background
const ghosttyDarkColors = buildDarkSemanticColors({
  surface0: "#282c34",
  surface1: "#2f333d",
  surface2: "#383c48",
  surface3: "#4a4f5e",
  surface4: "#5b6175",
  surfaceDiffEmpty: "#323643",
  surfaceSidebar: "#21252d",
  surfaceSidebarHover: "#292d36",
  foregroundMuted: "#c8ccd8",
  foregroundExtraMuted: "#a0a4b2",
  scrollbarHandle: "#a0a4b2",
  border: "#353a47",
  borderAccent: "#3f4454",
  accent: "#89b4fa",
  accentBright: "#b4d0fc",
  destructive: "#c44a55", // red with slight cool lean against the slate-blue surfaces
});

// ---------------------------------------------------------------------------
// Catppuccin — official palette (https://github.com/catppuccin/catppuccin)
// Latte = light; Frappé / Macchiato / Mocha = dark flavors.
// Accent uses mauve (signature); terminal ANSI maps to flavor reds/greens/etc.
// ---------------------------------------------------------------------------

interface CatppuccinPalette {
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  surface2: string;
  overlay0: string;
  overlay1: string;
  text: string;
  subtext0: string;
  subtext1: string;
  mauve: string;
  lavender: string;
  blue: string;
  sapphire: string;
  sky: string;
  teal: string;
  green: string;
  yellow: string;
  peach: string;
  red: string;
  maroon: string;
  pink: string;
}

const CATPPUCCIN_LATTE: CatppuccinPalette = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
  surface0: "#ccd0da",
  surface1: "#bcc0cc",
  surface2: "#acb0be",
  overlay0: "#9ca0b0",
  overlay1: "#8c8fa1",
  text: "#4c4f69",
  subtext0: "#6c6f85",
  subtext1: "#5c5f77",
  mauve: "#8839ef",
  lavender: "#7287fd",
  blue: "#1e66f5",
  sapphire: "#209fb5",
  sky: "#04a5e5",
  teal: "#179299",
  green: "#40a02b",
  yellow: "#df8e1d",
  peach: "#fe640b",
  red: "#d20f39",
  maroon: "#e64553",
  pink: "#ea76cb",
};

const CATPPUCCIN_FRAPPE: CatppuccinPalette = {
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
  surface0: "#414559",
  surface1: "#51576d",
  surface2: "#626880",
  overlay0: "#737994",
  overlay1: "#838ba7",
  text: "#c6d0f5",
  subtext0: "#a5adce",
  subtext1: "#b5bfe2",
  mauve: "#ca9ee6",
  lavender: "#babbf1",
  blue: "#8caaee",
  sapphire: "#85c1dc",
  sky: "#99d1db",
  teal: "#81c8be",
  green: "#a6d189",
  yellow: "#e5c890",
  peach: "#ef9f76",
  red: "#e78284",
  maroon: "#ea999c",
  pink: "#f4b8e4",
};

const CATPPUCCIN_MACCHIATO: CatppuccinPalette = {
  base: "#24273a",
  mantle: "#1e2030",
  crust: "#181926",
  surface0: "#363a4f",
  surface1: "#494d64",
  surface2: "#5b6078",
  overlay0: "#6e738d",
  overlay1: "#8087a2",
  text: "#cad3f5",
  subtext0: "#a5adcb",
  subtext1: "#b8c0e0",
  mauve: "#c6a0f6",
  lavender: "#b7bdf8",
  blue: "#8aadf4",
  sapphire: "#7dc4e4",
  sky: "#91d7e3",
  teal: "#8bd5ca",
  green: "#a6da95",
  yellow: "#eed49f",
  peach: "#f5a97f",
  red: "#ed8796",
  maroon: "#ee99a0",
  pink: "#f5bde6",
};

const CATPPUCCIN_MOCHA: CatppuccinPalette = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  overlay1: "#7f849c",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  mauve: "#cba6f7",
  lavender: "#b4befe",
  blue: "#89b4fa",
  sapphire: "#74c7ec",
  sky: "#89dceb",
  teal: "#94e2d5",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  maroon: "#eba0ac",
  pink: "#f5c2e7",
};

function buildCatppuccinDarkTint(p: CatppuccinPalette): DarkThemeConfig {
  return {
    surface0: p.base,
    surface1: p.surface0,
    surface2: p.surface1,
    surface3: p.surface2,
    surface4: p.overlay0,
    surfaceDiffEmpty: p.mantle,
    surfaceSidebar: p.mantle,
    surfaceSidebarHover: p.surface0,
    foregroundMuted: p.subtext0,
    foregroundExtraMuted: p.overlay0,
    scrollbarHandle: p.overlay0,
    border: p.surface0,
    borderAccent: p.surface1,
    accent: p.mauve,
    accentBright: p.lavender,
    destructive: p.red,
    ultracodeGlow: { border: p.lavender, halo: p.mauve },
  };
}

const catppuccinFrappeColors = buildDarkSemanticColors(buildCatppuccinDarkTint(CATPPUCCIN_FRAPPE));
const catppuccinMacchiatoColors = buildDarkSemanticColors(
  buildCatppuccinDarkTint(CATPPUCCIN_MACCHIATO),
);
const catppuccinMochaColors = buildDarkSemanticColors(buildCatppuccinDarkTint(CATPPUCCIN_MOCHA));

// Latte light — built like other light semantics so buildLightTheme accepts it.
const catppuccinLatteSemanticColors = {
  surface0: CATPPUCCIN_LATTE.base,
  surface1: CATPPUCCIN_LATTE.mantle,
  surface2: CATPPUCCIN_LATTE.crust,
  surface3: CATPPUCCIN_LATTE.surface0,
  surface4: CATPPUCCIN_LATTE.surface1,
  surfaceDiffEmpty: CATPPUCCIN_LATTE.mantle,
  surfaceSidebar: CATPPUCCIN_LATTE.mantle,
  surfaceSidebarHover: CATPPUCCIN_LATTE.crust,
  surfaceWorkspace: CATPPUCCIN_LATTE.base,
  surfaceShell: CATPPUCCIN_LATTE.base,
  surfaceGlass: withAlpha(CATPPUCCIN_LATTE.mantle, 0.62),
  surfaceGlassStrong: withAlpha(CATPPUCCIN_LATTE.mantle, 0.94),
  foreground: CATPPUCCIN_LATTE.text,
  foregroundMuted: CATPPUCCIN_LATTE.subtext0,
  foregroundExtraMuted: CATPPUCCIN_LATTE.overlay0,
  scrollbarHandle: CATPPUCCIN_LATTE.overlay1,
  border: CATPPUCCIN_LATTE.surface0,
  borderAccent: CATPPUCCIN_LATTE.crust,
  accent: CATPPUCCIN_LATTE.mauve,
  accentBright: CATPPUCCIN_LATTE.lavender,
  accentForeground: "#ffffff",
  ultracodeGlow: {
    border: CATPPUCCIN_LATTE.lavender,
    halo: CATPPUCCIN_LATTE.mauve,
  },
  destructive: CATPPUCCIN_LATTE.red,
  destructiveForeground: "#ffffff",
  success: CATPPUCCIN_LATTE.green,
  successForeground: "#ffffff",
  background: CATPPUCCIN_LATTE.base,
  popover: CATPPUCCIN_LATTE.base,
  popoverForeground: CATPPUCCIN_LATTE.text,
  primary: CATPPUCCIN_LATTE.text,
  primaryForeground: CATPPUCCIN_LATTE.base,
  secondary: CATPPUCCIN_LATTE.mantle,
  secondaryForeground: CATPPUCCIN_LATTE.text,
  muted: CATPPUCCIN_LATTE.mantle,
  mutedForeground: CATPPUCCIN_LATTE.subtext0,
  accentBorder: CATPPUCCIN_LATTE.crust,
  input: CATPPUCCIN_LATTE.crust,
  ring: CATPPUCCIN_LATTE.mauve,
  ...lightDiffColors,
  ...lightStatusColors,
  // Prefer Catppuccin green/red for diffs on Latte.
  diffAddition: CATPPUCCIN_LATTE.green,
  diffDeletion: CATPPUCCIN_LATTE.red,
  statusSuccess: CATPPUCCIN_LATTE.green,
  statusDanger: CATPPUCCIN_LATTE.red,
  statusWarning: CATPPUCCIN_LATTE.yellow,
  statusMerged: CATPPUCCIN_LATTE.mauve,
  statusPlanning: CATPPUCCIN_LATTE.sapphire,
  terminal: {
    background: CATPPUCCIN_LATTE.base,
    foreground: CATPPUCCIN_LATTE.text,
    cursor: CATPPUCCIN_LATTE.text,
    cursorAccent: CATPPUCCIN_LATTE.base,
    selectionBackground: "rgba(76, 79, 105, 0.15)",
    selectionForeground: CATPPUCCIN_LATTE.text,
    black: CATPPUCCIN_LATTE.subtext1,
    red: CATPPUCCIN_LATTE.red,
    green: CATPPUCCIN_LATTE.green,
    yellow: CATPPUCCIN_LATTE.yellow,
    blue: CATPPUCCIN_LATTE.blue,
    magenta: CATPPUCCIN_LATTE.mauve,
    cyan: CATPPUCCIN_LATTE.teal,
    white: CATPPUCCIN_LATTE.base,
    brightBlack: CATPPUCCIN_LATTE.overlay1,
    brightRed: CATPPUCCIN_LATTE.maroon,
    brightGreen: CATPPUCCIN_LATTE.green,
    brightYellow: CATPPUCCIN_LATTE.yellow,
    brightBlue: CATPPUCCIN_LATTE.lavender,
    brightMagenta: CATPPUCCIN_LATTE.pink,
    brightCyan: CATPPUCCIN_LATTE.sky,
    brightWhite: "#ffffff",
  },
} as const;

export const SPACING = {
  0: 0,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

export const BORDER_RADIUS = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

// Platform default font stacks — copied verbatim from constants/theme.ts `Fonts`
// (sans -> ui, mono -> mono). These seed the dynamic `fontFamily` theme token and
// are the fallback an empty user-supplied family resolves to at apply time.
export const DEFAULT_UI_FONT_STACK: string = Platform.select({
  ios: "system-ui",
  default: "normal",
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

export const DEFAULT_MONO_FONT_STACK: string = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
  web: "'Maple Mono NF CN', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// `fontSize`, `fontFamily`, and `lineHeight` are deliberately widened to plain
// `number`/`string` (not narrowed by `as const`) so the appearance updater can patch
// them at runtime via `UnistylesRuntime.updateTheme`. The remaining tokens keep their
// literal types.
interface CommonTheme {
  spacing: typeof SPACING;
  fontSize: Record<keyof typeof FONT_SIZE, number>;
  fontFamily: { ui: string; mono: string };
  lineHeight: Record<keyof typeof LINE_HEIGHT, number>;
  iconSize: typeof ICON_SIZE;
  fontWeight: typeof FONT_WEIGHT;
  borderRadius: typeof BORDER_RADIUS;
  borderWidth: typeof BORDER_WIDTH;
  opacity: typeof OPACITY;
  // Shell chrome layout — drives whether the content (tabs + panes) floats as an
  // inset rounded card with bordered-less sidebars (new theme) or fills edge-to-edge
  // with bordered sidebars (classic). Patched per-theme so the layout reacts through
  // Unistyles with no React re-render, gated to whichever theme is active.
  shell: {
    contentMargin: number; // margin around the floating content card
    contentRadius: number; // content card corner radius
    contentOverflow: "visible" | "hidden"; // clip card children to the radius
    chromeDivider: number; // chrome divider border width — sidebars + workspace header (0 hides them)
    controlBorder: number; // resting outline width for inputs / dropdown triggers (0 = borderless in the new theme)
    floating: boolean; // true in the new theme — lets stylesheets branch the floating look
  };
  // Programming ligatures for mono code + terminal. Patched at runtime by
  // applyAppearance from settings.terminalLigaturesEnabled so StyleSheet factories
  // and AppearanceStyleBoundary remount with the right font features.
  monoLigatures: boolean;
}

const commonTheme: CommonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  fontFamily: { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_MONO_FONT_STACK },
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
  // Classic shell: flush full-bleed content, 1px sidebar dividers.
  shell: {
    contentMargin: SPACING[0],
    contentRadius: BORDER_RADIUS.none,
    contentOverflow: "visible",
    chromeDivider: BORDER_WIDTH[1],
    controlBorder: BORDER_WIDTH[1],
    floating: false,
  },
  monoLigatures: true,
};

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(paseoDarkColors);
export const darkZincTheme = buildDarkTheme(zincDarkColors);
export const darkMidnightTheme = buildDarkTheme(midnightDarkColors);
export const darkClaudeTheme = buildDarkTheme(claudeDarkColors);
export const darkGhosttyTheme = buildDarkTheme(ghosttyDarkColors);
export const darkCatppuccinFrappeTheme = buildDarkTheme(catppuccinFrappeColors);
export const darkCatppuccinMacchiatoTheme = buildDarkTheme(catppuccinMacchiatoColors);
export const darkCatppuccinMochaTheme = buildDarkTheme(catppuccinMochaColors);

const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.02)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.04)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

// Widened string shape shared by all light variants so they register as a
// single Unistyles theme type, matching how the dark variants behave.
type LightSemanticColors = {
  [K in keyof typeof lightSemanticColors]: (typeof lightSemanticColors)[K] extends string
    ? string
    : { [K2 in keyof (typeof lightSemanticColors)[K]]: string };
};

function buildLightTheme(semanticColors: LightSemanticColors) {
  return {
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const lightTheme = buildLightTheme(lightSemanticColors);
export const lightClaudeTheme = buildLightTheme(claudeLightSemanticColors);
export const lightCatppuccinLatteTheme = buildLightTheme(catppuccinLatteSemanticColors);
// Shared layout for both new-theme palettes — floating inset card, no chrome
// dividers, borderless controls. Classic themes keep commonTheme.shell defaults.
const newThemeShell = {
  contentMargin: SPACING[2], // 8 — gap around the floating card
  contentRadius: BORDER_RADIUS.xl, // 12
  contentOverflow: "hidden", // clip tab row + panes to the rounded corners
  chromeDivider: BORDER_WIDTH[0], // 0 — no sidebar / header divider lines
  controlBorder: BORDER_WIDTH[0], // 0 — borderless inputs / dropdown triggers
  floating: true,
} as const;

export const newTheme = { ...buildLightTheme(newThemeSemanticColors), shell: newThemeShell };

// Claude light + new-theme shell: warm ivory floating cards on cream chrome,
// terracotta accent preserved from classic Claude Light.
const NEW_THEME_CLAUDE_CHROME = "#f0eee6"; // cream underlay (warm #fafafa)
const newThemeClaudeSemanticColors = {
  ...claudeLightSemanticColors,
  // Continuous cream chrome (sidebars + shell margins).
  surfaceSidebar: NEW_THEME_CLAUDE_CHROME,
  surfaceShell: NEW_THEME_CLAUDE_CHROME,
  scrollbarHandle: NEW_THEME_CLAUDE_CHROME,
  // Floating content stays ivory — one step lighter than the cream underlay.
  surface0: "#faf9f5",
  surfaceWorkspace: "#faf9f5",
};

export const newThemeClaude = {
  ...buildLightTheme(newThemeClaudeSemanticColors),
  shell: newThemeShell,
};

// Shared dark floating layering for every dark tint under the new-theme toggle:
//   chrome / sidebars: pure black
//   floating page panel (workspace + settings outer): tinted elevated panel
//   nested settings rows (surface1): pure black
const NEW_THEME_DARK_CHROME = "#000000";
const NEW_THEME_DARK_SETTINGS_CARD = "#000000";

function buildNewThemeDarkFloatingSemantic(
  panel: string,
  tint: Omit<DarkThemeConfig, "surface0" | "surface1" | "surfaceSidebar" | "scrollbarHandle"> &
    Partial<Pick<DarkThemeConfig, "accentForeground" | "ultracodeGlow">>,
) {
  return {
    ...buildDarkSemanticColors({
      surface0: panel,
      surface1: NEW_THEME_DARK_SETTINGS_CARD,
      surface2: tint.surface2,
      surface3: tint.surface3,
      surface4: tint.surface4,
      surfaceDiffEmpty: tint.surfaceDiffEmpty,
      surfaceSidebar: NEW_THEME_DARK_CHROME,
      surfaceSidebarHover: tint.surfaceSidebarHover,
      foregroundMuted: tint.foregroundMuted,
      foregroundExtraMuted: tint.foregroundExtraMuted,
      scrollbarHandle: NEW_THEME_DARK_CHROME,
      border: tint.border,
      borderAccent: tint.borderAccent,
      accent: tint.accent,
      accentBright: tint.accentBright,
      accentForeground: tint.accentForeground,
      destructive: tint.destructive,
      ultracodeGlow: tint.ultracodeGlow,
    }),
    surfaceShell: NEW_THEME_DARK_CHROME,
    surfaceSidebar: NEW_THEME_DARK_CHROME,
    surfaceWorkspace: panel,
    scrollbarHandle: NEW_THEME_DARK_CHROME,
  };
}

// Zinc-neutral floating dark (also the auto/system dark default).
export const newThemeDark = {
  ...buildDarkTheme(
    buildNewThemeDarkFloatingSemantic("#121214", {
      surface2: "#1a1a1e",
      surface3: "#26262c",
      surface4: "#34343c",
      surfaceDiffEmpty: "#141418",
      surfaceSidebarHover: "#1a1a1e",
      foregroundMuted: "#a8a8b3",
      foregroundExtraMuted: "#787883",
      border: "#26262c",
      borderAccent: "#34343c",
      accent: "#e4e4e7",
      accentBright: "#fafafa",
      accentForeground: "#18181b",
      destructive: "#c44a4a",
    }),
  ),
  shell: newThemeShell,
};

// Paseo (dropdown "Dark") — teal-green accent on the floating shell.
export const newThemePaseoDark = {
  ...buildDarkTheme(
    buildNewThemeDarkFloatingSemantic("#181B1A", {
      surface2: "#272A29",
      surface3: "#434645",
      surface4: "#595B5B",
      surfaceDiffEmpty: "#252827",
      surfaceSidebarHover: "#1c1f1e",
      foregroundMuted: "#A1A5A4",
      foregroundExtraMuted: "#717574",
      border: "#252B2A",
      borderAccent: "#2F3534",
      accent: "#20744A",
      accentBright: "#7ccba0",
      destructive: "#c64f43",
    }),
  ),
  shell: newThemeShell,
};

// Midnight — cool blue tint + blue accent.
export const newThemeMidnightDark = {
  ...buildDarkTheme(
    buildNewThemeDarkFloatingSemantic("#161820", {
      surface2: "#252731",
      surface3: "#3c3e4c",
      surface4: "#535564",
      surfaceDiffEmpty: "#222430",
      surfaceSidebarHover: "#1a1c28",
      foregroundMuted: "#9a9db0",
      foregroundExtraMuted: "#6b6e82",
      border: "#242636",
      borderAccent: "#2e3040",
      accent: "#3b6fcf",
      accentBright: "#7eaaeb",
      destructive: "#c44a52",
    }),
  ),
  shell: newThemeShell,
};

// Ghostty — slate-blue surfaces + light blue accent.
export const newThemeGhosttyDark = {
  ...buildDarkTheme(
    buildNewThemeDarkFloatingSemantic("#282c34", {
      surface2: "#383c48",
      surface3: "#4a4f5e",
      surface4: "#5b6175",
      surfaceDiffEmpty: "#323643",
      surfaceSidebarHover: "#292d36",
      foregroundMuted: "#c8ccd8",
      foregroundExtraMuted: "#a0a4b2",
      border: "#353a47",
      borderAccent: "#3f4454",
      accent: "#89b4fa",
      accentBright: "#b4d0fc",
      destructive: "#c44a55",
    }),
  ),
  shell: newThemeShell,
};

// Claude dark — warm charcoal panel + terracotta accent.
export const newThemeClaudeDark = {
  ...buildDarkTheme(
    buildNewThemeDarkFloatingSemantic("#1a1918", {
      surface2: "#2f2d2b",
      surface3: "#4a4745",
      surface4: "#605d5b",
      surfaceDiffEmpty: "#2a2826",
      surfaceSidebarHover: "#222120",
      foregroundMuted: "#ada9a5",
      foregroundExtraMuted: "#78746f",
      border: "#2c2a27",
      borderAccent: "#36332f",
      accent: "#d97757",
      accentBright: "#e89a7f",
      destructive: "#cf513e",
      ultracodeGlow: { border: "#c97c5d", halo: "#d97757" },
    }),
  ),
  shell: newThemeShell,
};

// Catppuccin Latte floating light — mantle chrome, base card, mauve accent.
const NEW_THEME_CATPPUCCIN_LATTE_CHROME = CATPPUCCIN_LATTE.mantle;
const newThemeCatppuccinLatteSemanticColors = {
  ...catppuccinLatteSemanticColors,
  surfaceSidebar: NEW_THEME_CATPPUCCIN_LATTE_CHROME,
  surfaceShell: NEW_THEME_CATPPUCCIN_LATTE_CHROME,
  scrollbarHandle: NEW_THEME_CATPPUCCIN_LATTE_CHROME,
  surface0: CATPPUCCIN_LATTE.base,
  surfaceWorkspace: CATPPUCCIN_LATTE.base,
};

export const newThemeCatppuccinLatte = {
  ...buildLightTheme(newThemeCatppuccinLatteSemanticColors),
  shell: newThemeShell,
};

function newThemeCatppuccinDarkFloating(p: CatppuccinPalette) {
  const tint = buildCatppuccinDarkTint(p);
  return {
    ...buildDarkTheme(
      buildNewThemeDarkFloatingSemantic(p.base, {
        surface2: tint.surface2,
        surface3: tint.surface3,
        surface4: tint.surface4,
        surfaceDiffEmpty: tint.surfaceDiffEmpty,
        surfaceSidebarHover: tint.surfaceSidebarHover,
        foregroundMuted: tint.foregroundMuted,
        foregroundExtraMuted: tint.foregroundExtraMuted,
        border: tint.border,
        borderAccent: tint.borderAccent,
        accent: tint.accent,
        accentBright: tint.accentBright,
        destructive: tint.destructive,
        ultracodeGlow: tint.ultracodeGlow,
      }),
    ),
    shell: newThemeShell,
  };
}

export const newThemeCatppuccinFrappe = newThemeCatppuccinDarkFloating(CATPPUCCIN_FRAPPE);
export const newThemeCatppuccinMacchiato = newThemeCatppuccinDarkFloating(CATPPUCCIN_MACCHIATO);
export const newThemeCatppuccinMocha = newThemeCatppuccinDarkFloating(CATPPUCCIN_MOCHA);

// Authoritative Unistyles-theme-key → colorScheme map, derived from the theme
// objects' own `colorScheme` so it can't drift. Use this anywhere only the theme
// NAME is available — notably a `StyleSheet.create((theme, rt) => …)` factory on
// web, where every string leaf on `theme` (including `theme.colorScheme`) is
// rewritten to a `var(--…)` reference and is unusable as a value (see
// docs/unistyles.md). A name-prefix heuristic is NOT enough: the fork's
// `newTheme*` keys start with neither "light" nor "dark".
const THEME_NAME_TO_COLOR_SCHEME = {
  light: lightTheme.colorScheme,
  lightClaude: lightClaudeTheme.colorScheme,
  lightCatppuccinLatte: lightCatppuccinLatteTheme.colorScheme,
  newTheme: newTheme.colorScheme,
  newThemeClaude: newThemeClaude.colorScheme,
  newThemeCatppuccinLatte: newThemeCatppuccinLatte.colorScheme,
  newThemeDark: newThemeDark.colorScheme,
  newThemePaseoDark: newThemePaseoDark.colorScheme,
  newThemeMidnightDark: newThemeMidnightDark.colorScheme,
  newThemeGhosttyDark: newThemeGhosttyDark.colorScheme,
  newThemeClaudeDark: newThemeClaudeDark.colorScheme,
  newThemeCatppuccinFrappe: newThemeCatppuccinFrappe.colorScheme,
  newThemeCatppuccinMacchiato: newThemeCatppuccinMacchiato.colorScheme,
  newThemeCatppuccinMocha: newThemeCatppuccinMocha.colorScheme,
  dark: darkTheme.colorScheme,
  darkZinc: darkZincTheme.colorScheme,
  darkMidnight: darkMidnightTheme.colorScheme,
  darkClaude: darkClaudeTheme.colorScheme,
  darkGhostty: darkGhosttyTheme.colorScheme,
  darkCatppuccinFrappe: darkCatppuccinFrappeTheme.colorScheme,
  darkCatppuccinMacchiato: darkCatppuccinMacchiatoTheme.colorScheme,
  darkCatppuccinMocha: darkCatppuccinMochaTheme.colorScheme,
} satisfies Record<string, "light" | "dark">;

// Falls back to "dark" for unknown names (the app's dark-default, and the only
// names seen before settings load are `light`/`dark`, both mapped above).
export function colorSchemeForThemeName(themeName: string): "light" | "dark" {
  return THEME_NAME_TO_COLOR_SCHEME[themeName as keyof typeof THEME_NAME_TO_COLOR_SCHEME] ?? "dark";
}

// When the new-theme toggle is on, shell.floating stays on and the dropdown picks
// which new-theme *palette* to use (every ThemeName has a dedicated floating key).
// `auto` follows the system light/dark with the neutral floating pair.
export type NewThemeUnistylesKey =
  | "newTheme"
  | "newThemeClaude"
  | "newThemeCatppuccinLatte"
  | "newThemeDark"
  | "newThemePaseoDark"
  | "newThemeMidnightDark"
  | "newThemeGhosttyDark"
  | "newThemeClaudeDark"
  | "newThemeCatppuccinFrappe"
  | "newThemeCatppuccinMacchiato"
  | "newThemeCatppuccinMocha";

export function isLightThemeSelection(
  theme: ThemeName | "auto",
  systemScheme: "light" | "dark",
): boolean {
  if (theme === "auto") {
    return systemScheme === "light";
  }
  return theme === "light" || theme === "claudeLight" || theme === "catppuccinLatte";
}

export function resolveNewThemeUnistylesKey(
  theme: ThemeName | "auto",
  systemScheme: "light" | "dark" = "dark",
): NewThemeUnistylesKey {
  switch (theme) {
    case "light":
      return "newTheme";
    case "claudeLight":
      return "newThemeClaude";
    case "catppuccinLatte":
      return "newThemeCatppuccinLatte";
    case "dark":
      return "newThemePaseoDark";
    case "zinc":
      return "newThemeDark";
    case "midnight":
      return "newThemeMidnightDark";
    case "claude":
      return "newThemeClaudeDark";
    case "ghostty":
      return "newThemeGhosttyDark";
    case "catppuccinFrappe":
      return "newThemeCatppuccinFrappe";
    case "catppuccinMacchiato":
      return "newThemeCatppuccinMacchiato";
    case "catppuccinMocha":
      return "newThemeCatppuccinMocha";
    case "auto":
      return systemScheme === "light" ? "newTheme" : "newThemeDark";
    default: {
      // Exhaustiveness: if ThemeName grows, TypeScript flags a missing case.
      const _exhaustive: never = theme;
      return _exhaustive;
    }
  }
}

// Keep compatibility with existing code
export const theme = darkTheme;

// Export a union type that works for both themes
export type Theme = typeof darkTheme | typeof lightTheme;

type UnistylesThemeKey =
  | "light"
  | "lightClaude"
  | "lightCatppuccinLatte"
  | "dark"
  | "darkZinc"
  | "darkMidnight"
  | "darkClaude"
  | "darkGhostty"
  | "darkCatppuccinFrappe"
  | "darkCatppuccinMacchiato"
  | "darkCatppuccinMocha";

export const THEME_TO_UNISTYLES: Record<ThemeName, UnistylesThemeKey> = {
  light: "light",
  claudeLight: "lightClaude",
  catppuccinLatte: "lightCatppuccinLatte",
  dark: "dark",
  zinc: "darkZinc",
  midnight: "darkMidnight",
  claude: "darkClaude",
  ghostty: "darkGhostty",
  catppuccinFrappe: "darkCatppuccinFrappe",
  catppuccinMacchiato: "darkCatppuccinMacchiato",
  catppuccinMocha: "darkCatppuccinMocha",
};

export const THEME_SWATCHES: Record<ThemeName, string> = {
  light: "#ffffff",
  claudeLight: "#f0eee6",
  catppuccinLatte: CATPPUCCIN_LATTE.mauve,
  dark: "#2D8B62",
  zinc: "#808080",
  midnight: "#4A6BA8",
  claude: "#D97757",
  ghostty: "#8caaee",
  catppuccinFrappe: CATPPUCCIN_FRAPPE.mauve,
  catppuccinMacchiato: CATPPUCCIN_MACCHIATO.mauve,
  catppuccinMocha: CATPPUCCIN_MOCHA.mauve,
};

export const PROJECT_ICON_COLORS = [
  "#8b5cf6",
  "#0ea5e9",
  "#10b981",
  "#f97316",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
  "#ef4444",
  "#eab308",
  "#3b82f6",
] as const;
