import { describe, expect, it } from "vitest";
import {
  colorSchemeForThemeName,
  darkCatppuccinFrappeTheme,
  darkCatppuccinMacchiatoTheme,
  darkCatppuccinMochaTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkMidnightTheme,
  darkTheme,
  darkZincTheme,
  lightCatppuccinLatteTheme,
  lightClaudeTheme,
  lightTheme,
  newTheme,
  newThemeCatppuccinFrappe,
  newThemeCatppuccinLatte,
  newThemeCatppuccinMacchiato,
  newThemeCatppuccinMocha,
  newThemeClaude,
  newThemeClaudeDark,
  newThemeDark,
  newThemeGhosttyDark,
  newThemeMidnightDark,
  newThemePaseoDark,
  resolveNewThemeUnistylesKey,
  type ThemeName,
  darkPureBlackTheme,
  FONT_SIZE,
  getNextThemePreference,
  THEME_OPTIONS,
} from "./theme";

const ALL_DROPDOWN_THEMES: ThemeName[] = [
  "light",
  "claudeLight",
  "catppuccinLatte",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "catppuccinFrappe",
  "catppuccinMacchiato",
  "catppuccinMocha",
];

describe("colorSchemeForThemeName", () => {
  it.each([
    ["light", lightTheme.colorScheme],
    ["lightClaude", lightClaudeTheme.colorScheme],
    ["lightCatppuccinLatte", lightCatppuccinLatteTheme.colorScheme],
    ["newTheme", newTheme.colorScheme],
    ["newThemeClaude", newThemeClaude.colorScheme],
    ["newThemeCatppuccinLatte", newThemeCatppuccinLatte.colorScheme],
    ["newThemeDark", newThemeDark.colorScheme],
    ["newThemePaseoDark", newThemePaseoDark.colorScheme],
    ["newThemeMidnightDark", newThemeMidnightDark.colorScheme],
    ["newThemeGhosttyDark", newThemeGhosttyDark.colorScheme],
    ["newThemeClaudeDark", newThemeClaudeDark.colorScheme],
    ["newThemeCatppuccinFrappe", newThemeCatppuccinFrappe.colorScheme],
    ["newThemeCatppuccinMacchiato", newThemeCatppuccinMacchiato.colorScheme],
    ["newThemeCatppuccinMocha", newThemeCatppuccinMocha.colorScheme],
    ["dark", darkTheme.colorScheme],
    ["darkZinc", darkZincTheme.colorScheme],
    ["darkMidnight", darkMidnightTheme.colorScheme],
    ["darkClaude", darkClaudeTheme.colorScheme],
    ["darkGhostty", darkGhosttyTheme.colorScheme],
    ["darkCatppuccinFrappe", darkCatppuccinFrappeTheme.colorScheme],
    ["darkCatppuccinMacchiato", darkCatppuccinMacchiatoTheme.colorScheme],
    ["darkCatppuccinMocha", darkCatppuccinMochaTheme.colorScheme],
  ])("maps %s to its theme's colorScheme", (name, expected) => {
    expect(colorSchemeForThemeName(name)).toBe(expected);
  });

  it("classifies Catppuccin Latte as light and other flavors as dark", () => {
    expect(colorSchemeForThemeName("lightCatppuccinLatte")).toBe("light");
    expect(colorSchemeForThemeName("newThemeCatppuccinLatte")).toBe("light");
    expect(colorSchemeForThemeName("darkCatppuccinFrappe")).toBe("dark");
    expect(colorSchemeForThemeName("darkCatppuccinMacchiato")).toBe("dark");
    expect(colorSchemeForThemeName("darkCatppuccinMocha")).toBe("dark");
    expect(colorSchemeForThemeName("newThemeCatppuccinMocha")).toBe("dark");
  });

  it("falls back to dark for unknown theme names", () => {
    expect(colorSchemeForThemeName("does-not-exist")).toBe("dark");
  });
});

describe("resolveNewThemeUnistylesKey", () => {
  it("maps every dropdown ThemeName to a dedicated floating palette", () => {
    expect(resolveNewThemeUnistylesKey("light")).toBe("newTheme");
    expect(resolveNewThemeUnistylesKey("claudeLight")).toBe("newThemeClaude");
    expect(resolveNewThemeUnistylesKey("catppuccinLatte")).toBe("newThemeCatppuccinLatte");
    expect(resolveNewThemeUnistylesKey("dark")).toBe("newThemePaseoDark");
    expect(resolveNewThemeUnistylesKey("zinc")).toBe("newThemeDark");
    expect(resolveNewThemeUnistylesKey("midnight")).toBe("newThemeMidnightDark");
    expect(resolveNewThemeUnistylesKey("claude")).toBe("newThemeClaudeDark");
    expect(resolveNewThemeUnistylesKey("ghostty")).toBe("newThemeGhosttyDark");
    expect(resolveNewThemeUnistylesKey("catppuccinFrappe")).toBe("newThemeCatppuccinFrappe");
    expect(resolveNewThemeUnistylesKey("catppuccinMacchiato")).toBe("newThemeCatppuccinMacchiato");
    expect(resolveNewThemeUnistylesKey("catppuccinMocha")).toBe("newThemeCatppuccinMocha");
  });

  it("covers all dropdown themes without collapsing distinct tints", () => {
    const keys = ALL_DROPDOWN_THEMES.map((name) => resolveNewThemeUnistylesKey(name));
    expect(new Set(keys).size).toBe(ALL_DROPDOWN_THEMES.length);
  });

  it("follows the system scheme when the dropdown is auto", () => {
    expect(resolveNewThemeUnistylesKey("auto", "light")).toBe("newTheme");
    expect(resolveNewThemeUnistylesKey("auto", "dark")).toBe("newThemeDark");
  });

  it("uses Catppuccin mauve accents on floating palettes", () => {
    expect(newThemeCatppuccinLatte.colors.accent.toLowerCase()).toBe("#8839ef");
    expect(newThemeCatppuccinFrappe.colors.accent.toLowerCase()).toBe("#ca9ee6");
    expect(newThemeCatppuccinMacchiato.colors.accent.toLowerCase()).toBe("#c6a0f6");
    expect(newThemeCatppuccinMocha.colors.accent.toLowerCase()).toBe("#cba6f7");
  });

  it("keeps floating shell tokens identical across Catppuccin floating palettes", () => {
    expect(newThemeCatppuccinLatte.shell).toEqual(newTheme.shell);
    expect(newThemeCatppuccinMocha.shell).toEqual(newTheme.shell);
    expect(newThemeCatppuccinLatte.shell.floating).toBe(true);
  });
});

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      xs: 12,
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "claudeLight",
      "catppuccinLatte",
      "catppuccinFrappe",
      "catppuccinMacchiato",
      "catppuccinMocha",
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("claudeLight");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light hover and selection darker than the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe("#e9e9ec");
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface4);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});
