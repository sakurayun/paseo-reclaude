import { describe, expect, it } from "vitest";

import { TERMINAL_COLOR_PRESETS } from "@/constants/terminal-color-presets";
import { terminalColorForSyntaxStyle } from "./ligature-preview-palette";

describe("terminalColorForSyntaxStyle", () => {
  const palette = TERMINAL_COLOR_PRESETS.oneDark;

  it("maps syntax roles onto the terminal 16-color palette", () => {
    expect(terminalColorForSyntaxStyle("keyword", palette)).toBe(palette.magenta);
    expect(terminalColorForSyntaxStyle("comment", palette)).toBe(palette.brightBlack);
    expect(terminalColorForSyntaxStyle("string", palette)).toBe(palette.green);
    expect(terminalColorForSyntaxStyle("number", palette)).toBe(palette.yellow);
    expect(terminalColorForSyntaxStyle("function", palette)).toBe(palette.blue);
    expect(terminalColorForSyntaxStyle("operator", palette)).toBe(palette.brightMagenta);
  });

  it("falls back to foreground for unknown or null styles", () => {
    expect(terminalColorForSyntaxStyle(null, palette)).toBe(palette.foreground);
    expect(terminalColorForSyntaxStyle("not-a-role", palette)).toBe(palette.foreground);
  });

  it("tracks the selected scheme palette (dracula differs from oneDark)", () => {
    const dracula = TERMINAL_COLOR_PRESETS.dracula;
    expect(terminalColorForSyntaxStyle("string", dracula)).toBe(dracula.green);
    expect(dracula.green).not.toBe(palette.green);
    expect(dracula.background).not.toBe(palette.background);
  });
});
