// Pure mono-ligature tokens + style helpers.
// IMPORTANT: This module must stay free of `react-native` / Platform imports.
// `terminal-emulator-runtime` is also bundled into the terminal WebView HTML via
// esbuild (`build-terminal-webview-html.mjs`); pulling RN Flow sources there
// fails EAS post-install with `Unexpected "typeof"`.

// OpenType feature string for programming ligatures (liga + contextual alts).
// Used by the xterm character joiner and by web CSS (apply-mono-ligatures.web.ts).
// Use numeric 1/0 — widely supported by canvas/WebGL texture atlas inheritance.
export const MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON = '"calt" 1, "liga" 1';
export const MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF = '"calt" 0, "liga" 0';

// Fallback join sequences when Local Font Access is unavailable (browser / denied).
// Sorted longest-first by the xterm joiner when used as fallbackLigatures.
export const MONO_FALLBACK_LIGATURES: readonly string[] = [
  "<---->",
  "<--->",
  "<====>",
  "<===>",
  "<--",
  "<---",
  "<<-",
  "<-",
  "->",
  "->>",
  "-->",
  "--->",
  "<==",
  "<===",
  "<<=",
  "<=",
  "=>",
  "=>>",
  "==>",
  "===>",
  ">=",
  ">>=",
  "<->",
  "<-->",
  "<=>",
  "<==>",
  ":::",
  "::",
  "<~~",
  "</>",
  "</",
  "/>",
  "~~>",
  "===",
  "!==",
  "!===",
  "==",
  "!=",
  "/=",
  "~=",
  "<>",
  "<:",
  ":=",
  "*=",
  "*+",
  "<*",
  "<*>",
  "*>",
  "<|",
  "<|>",
  "|>",
  "+*",
  "=*",
  "=:",
  ":>",
  "/*",
  "*/",
  "+++",
  "<!--",
  "<!---",
  "&&",
  "||",
  "??",
  "?.",
  "...",
  "..",
  "++",
  "--",
];

/** DOM-capable runtime (browser or RN-web) without importing react-native. */
function isDomRuntime(): boolean {
  return typeof document !== "undefined";
}

// StyleSheet-safe extras for mono code Text. Narrow return type — never spread a
// full TextStyle into StyleSheet.create (Unistyles typing breaks).
// Web OpenType features live in applyMonoLigatures CSS on [data-pmono] / .xterm.
export function monoLigatureTextStyle(enabled: boolean): {
  fontVariant?: Array<"common-ligatures">;
} {
  if (isDomRuntime() || !enabled) {
    return {};
  }
  return { fontVariant: ["common-ligatures"] };
}

// Inline style for web previews that need features without relying on CSS timing.
export function monoLigatureInlineWebStyle(enabled: boolean): {
  fontFeatureSettings?: string;
  fontVariant?: Array<"common-ligatures">;
} {
  if (!isDomRuntime()) {
    return monoLigatureTextStyle(enabled);
  }
  return {
    fontFeatureSettings: enabled
      ? MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON
      : MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF,
  };
}
