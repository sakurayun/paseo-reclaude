import { Asset } from "expo-asset";

/**
 * Fonts shipped inside the app bundle. "Maple Mono NF CN" carries Nerd Font
 * glyphs plus CJK coverage, so the terminal renders powerline prompts and
 * Chinese output without falling back to system fonts.
 */
const MAPLE_MONO_FACES = [
  { weight: "400", module: require("../assets/fonts/MapleMono-NF-CN-Regular.ttf") as number },
  { weight: "700", module: require("../assets/fonts/MapleMono-NF-CN-Bold.ttf") as number },
] as const;

export const MAPLE_MONO_FONT_FAMILY = "Maple Mono NF CN";

let registered = false;

/** Registers bundled fonts with the document so xterm/CSS can resolve them. */
export function registerBundledFonts(): void {
  if (registered || typeof document === "undefined") {
    return;
  }
  registered = true;
  for (const face of MAPLE_MONO_FACES) {
    try {
      const uri = Asset.fromModule(face.module).uri;
      const font = new FontFace(MAPLE_MONO_FONT_FAMILY, `url(${uri})`, { weight: face.weight });
      document.fonts.add(font);
      // Kick off the fetch now so the font is ready before a terminal opens.
      void font.load().catch(() => {});
    } catch {
      // A failed face load falls back to the rest of the mono stack.
    }
  }
}
