import * as Font from "expo-font";

export const MAPLE_MONO_FONT_FAMILY = "Maple Mono NF CN";

let registered = false;

/**
 * Registers bundled fonts on native. React Native has no weight-variant
 * font-face mapping, so bold registers under its own family name.
 */
export function registerBundledFonts(): void {
  if (registered) {
    return;
  }
  registered = true;
  void Font.loadAsync({
    [MAPLE_MONO_FONT_FAMILY]: require("../assets/fonts/MapleMono-NF-CN-Regular.ttf") as number,
    [`${MAPLE_MONO_FONT_FAMILY} Bold`]:
      require("../assets/fonts/MapleMono-NF-CN-Bold.ttf") as number,
  }).catch(() => {
    // Missing font falls back to the platform mono stack.
  });
}
