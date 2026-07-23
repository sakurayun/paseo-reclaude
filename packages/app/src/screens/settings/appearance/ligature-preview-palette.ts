import type { Theme } from "@/styles/theme";

export type TerminalPalette = Theme["colors"]["terminal"];

/**
 * Map CodeMirror highlight roles onto the 16-color terminal palette so the
 * ligature preview matches the Terminal color scheme (not the separate editor
 * syntax-theme setting).
 */
const SYNTAX_TO_TERMINAL_KEY: Record<string, keyof TerminalPalette> = {
  keyword: "magenta",
  comment: "brightBlack",
  meta: "brightBlack",
  string: "green",
  number: "yellow",
  literal: "brightYellow",
  function: "blue",
  definition: "brightBlue",
  class: "cyan",
  type: "cyan",
  tag: "red",
  attribute: "yellow",
  property: "brightCyan",
  variable: "foreground",
  // Operators carry ligature sequences (==>, !==, ->); keep them vivid.
  operator: "brightMagenta",
  punctuation: "white",
  regexp: "brightRed",
  escape: "brightYellow",
  heading: "brightBlue",
  link: "blue",
};

export function terminalColorForSyntaxStyle(
  style: string | null | undefined,
  palette: TerminalPalette,
): string {
  if (!style) {
    return palette.foreground;
  }
  const key = SYNTAX_TO_TERMINAL_KEY[style];
  return key ? palette[key] : palette.foreground;
}
