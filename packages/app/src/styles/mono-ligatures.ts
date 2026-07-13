import type { TextStyle } from "react-native";
import { isWeb } from "@/constants/platform";

// OpenType feature string for programming ligatures (liga + contextual alts).
// Used by the xterm LigaturesAddon and by web CSS (apply-mono-ligatures.web.ts).
// Use numeric 1/0 — widely supported by canvas/WebGL texture atlas inheritance.
export const MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON = '"calt" 1, "liga" 1';
export const MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF = '"calt" 0, "liga" 0';

// Fallback join sequences when Local Font Access is unavailable (browser / denied).
// Sorted longest-first by the xterm addon when used as fallbackLigatures.
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

// StyleSheet-safe extras for mono code Text. Narrow return type — never spread a
// full TextStyle into StyleSheet.create (Unistyles typing breaks).
// Web OpenType features live in applyMonoLigatures CSS on [data-pmono] / .xterm.
export function monoLigatureTextStyle(enabled: boolean): {
  fontVariant?: Array<"common-ligatures">;
} {
  if (isWeb || !enabled) {
    return {};
  }
  return { fontVariant: ["common-ligatures"] };
}

// Inline style for web previews that need features without relying on CSS timing.
export function monoLigatureInlineWebStyle(enabled: boolean): TextStyle {
  if (!isWeb) {
    return monoLigatureTextStyle(enabled) as TextStyle;
  }
  return {
    fontFeatureSettings: enabled
      ? MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON
      : MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF,
  } as TextStyle;
}
