import {
  MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF,
  MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON,
} from "@/styles/mono-ligatures";

// Global web rule for every code surface tagged with data-pmono (see code-surface.ts)
// plus DOM xterm hosts. Terminal cell joining still needs LigaturesAddon; this CSS
// keeps OpenType features on for any remaining text paint path and for non-xterm mono.
const STYLE_ID = "paseo-mono-ligatures";

function buildRule(enabled: boolean): string {
  const features = enabled
    ? MONO_LIGATURE_FONT_FEATURE_SETTINGS_ON
    : MONO_LIGATURE_FONT_FEATURE_SETTINGS_OFF;
  const variant = enabled ? "common-ligatures" : "none";
  // data-pmono: markdown fences, diffs, file pane, tool output, etc.
  // .xterm: host element style used by LigaturesAddon; reinforce liga+calt.
  return [`[data-pmono],[data-pmono] *`, `.xterm,.xterm *`]
    .map((sel) => `${sel}{font-feature-settings:${features};font-variant-ligatures:${variant};}`)
    .join("");
}

export function applyMonoLigatures(enabled: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = buildRule(enabled);
}
