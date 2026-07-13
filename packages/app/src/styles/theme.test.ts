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
