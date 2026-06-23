import { describe, expect, it } from "vitest";
import {
  colorSchemeForThemeName,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkMidnightTheme,
  darkTheme,
  darkZincTheme,
  lightClaudeTheme,
  lightTheme,
  newTheme,
} from "./theme";

describe("colorSchemeForThemeName", () => {
  // Each registered Unistyles theme key must resolve to its theme object's own
  // `colorScheme`. This is what lets a tool-call name (resolved by theme NAME in
  // a StyleSheet factory) match its glyph (resolved by `theme.colorScheme`).
  it.each([
    ["light", lightTheme.colorScheme],
    ["lightClaude", lightClaudeTheme.colorScheme],
    ["newTheme", newTheme.colorScheme],
    ["dark", darkTheme.colorScheme],
    ["darkZinc", darkZincTheme.colorScheme],
    ["darkMidnight", darkMidnightTheme.colorScheme],
    ["darkClaude", darkClaudeTheme.colorScheme],
    ["darkGhostty", darkGhosttyTheme.colorScheme],
  ])("maps %s to its theme's colorScheme", (name, expected) => {
    expect(colorSchemeForThemeName(name)).toBe(expected);
  });

  // Regression: the fork's `newTheme` is a LIGHT look whose key starts with
  // neither "light" nor "dark", so the old `startsWith("light")` heuristic
  // wrongly classified it as dark — making colored tool names pick the dark
  // tint while the glyph picked the light tint.
  it("classifies the fork's newTheme as light", () => {
    expect(colorSchemeForThemeName("newTheme")).toBe("light");
  });

  it("falls back to dark for unknown theme names", () => {
    expect(colorSchemeForThemeName("does-not-exist")).toBe("dark");
  });
});
