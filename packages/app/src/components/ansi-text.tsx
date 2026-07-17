import React, { useMemo, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { monoLigatureInlineWebStyle, monoLigatureTextStyle } from "@/styles/mono-ligatures";
import {
  parseAnsiToSpans,
  type AnsiColorRef,
  type AnsiNamedColor,
  type AnsiSpan,
  type AnsiSpanStyle,
} from "@/utils/ansi-spans";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

/** Same shape as theme.colors.terminal / resolveTerminalPalette output. */
export type AnsiTerminalPalette = Theme["colors"]["terminal"];

export interface AnsiFindHighlight {
  id: string;
  start: number;
  end: number;
  isCurrent?: boolean;
}

interface AnsiTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Optional search highlights, indexed against ANSI-stripped (visible) text. */
  findHighlights?: AnsiFindHighlight[];
  selectable?: boolean;
  /**
   * Terminal palette for named ANSI colors (16-color SGR). When omitted, falls
   * back to the active app theme's `colors.terminal`.
   */
  palette?: AnsiTerminalPalette;
  /** Programming ligatures (liga/calt) — mirrors the terminal setting. */
  ligaturesEnabled?: boolean;
}

function decorationStyles(style: AnsiSpanStyle): StyleProp<TextStyle>[] {
  const out: StyleProp<TextStyle>[] = [];
  if (style.bold) out.push(styles.bold);
  if (style.dim) out.push(styles.dim);
  if (style.italic) out.push(styles.italic);
  if (style.underline) out.push(styles.underline);
  if (style.strikethrough) out.push(styles.strikethrough);
  return out;
}

function namedColorHex(name: AnsiNamedColor, palette: AnsiTerminalPalette): string {
  return palette[name];
}

function resolveColorStyle(
  color: AnsiColorRef,
  role: "fg" | "bg",
  palette: AnsiTerminalPalette | undefined,
): StyleProp<TextStyle> | null {
  if (color.kind === "default") {
    // Explicit default only needed after reverse video swaps a slot.
    return null;
  }
  if (color.kind === "named") {
    if (palette) {
      const hex = namedColorHex(color.name, palette);
      return role === "fg"
        ? inlineUnistylesStyle({ color: hex })
        : inlineUnistylesStyle({ backgroundColor: hex });
    }
    // Theme-bound StyleSheet path (auto palette).
    return role === "fg" ? themeNamedFgStyle(color.name) : themeNamedBgStyle(color.name);
  }
  // truecolor / 256-color rgb
  return role === "fg"
    ? inlineUnistylesStyle({ color: color.hex })
    : inlineUnistylesStyle({ backgroundColor: color.hex });
}

function themeNamedFgStyle(name: AnsiNamedColor): StyleProp<TextStyle> {
  switch (name) {
    case "black":
      return styles.fgBlack;
    case "red":
      return styles.fgRed;
    case "green":
      return styles.fgGreen;
    case "yellow":
      return styles.fgYellow;
    case "blue":
      return styles.fgBlue;
    case "magenta":
      return styles.fgMagenta;
    case "cyan":
      return styles.fgCyan;
    case "white":
      return styles.fgWhite;
    case "brightBlack":
      return styles.fgBrightBlack;
    case "brightRed":
      return styles.fgBrightRed;
    case "brightGreen":
      return styles.fgBrightGreen;
    case "brightYellow":
      return styles.fgBrightYellow;
    case "brightBlue":
      return styles.fgBrightBlue;
    case "brightMagenta":
      return styles.fgBrightMagenta;
    case "brightCyan":
      return styles.fgBrightCyan;
    case "brightWhite":
      return styles.fgBrightWhite;
  }
}

function themeNamedBgStyle(name: AnsiNamedColor): StyleProp<TextStyle> {
  switch (name) {
    case "black":
      return styles.bgBlack;
    case "red":
      return styles.bgRed;
    case "green":
      return styles.bgGreen;
    case "yellow":
      return styles.bgYellow;
    case "blue":
      return styles.bgBlue;
    case "magenta":
      return styles.bgMagenta;
    case "cyan":
      return styles.bgCyan;
    case "white":
      return styles.bgWhite;
    case "brightBlack":
      return styles.bgBrightBlack;
    case "brightRed":
      return styles.bgBrightRed;
    case "brightGreen":
      return styles.bgBrightGreen;
    case "brightYellow":
      return styles.bgBrightYellow;
    case "brightBlue":
      return styles.bgBrightBlue;
    case "brightMagenta":
      return styles.bgBrightMagenta;
    case "brightCyan":
      return styles.bgBrightCyan;
    case "brightWhite":
      return styles.bgBrightWhite;
  }
}

function spanToStyle(
  spanStyle: AnsiSpanStyle,
  palette: AnsiTerminalPalette | undefined,
): StyleProp<TextStyle> {
  let fg = spanStyle.fg;
  let bg = spanStyle.bg;
  if (spanStyle.reverse) {
    const tmp = fg;
    fg = bg.kind === "default" && palette ? { kind: "rgb", hex: palette.background } : bg;
    bg = tmp.kind === "default" && palette ? { kind: "rgb", hex: palette.foreground } : tmp;
  }

  return [
    resolveColorStyle(fg, "fg", palette),
    resolveColorStyle(bg, "bg", palette),
    ...decorationStyles(spanStyle),
  ];
}

function highlightStyleFor(highlight: AnsiFindHighlight | undefined): StyleProp<TextStyle> {
  if (!highlight) return null;
  if (highlight.isCurrent) return styles.hitCurrent;
  return styles.hit;
}

/**
 * Apply find-highlight ranges (visible-text offsets) by splitting ANSI spans.
 * Highlight styling wins over ANSI for the marked region so the match stays
 * readable against any terminal color.
 */
function applyFindHighlights(
  spans: AnsiSpan[],
  highlights: AnsiFindHighlight[] | undefined,
): Array<{ key: string; text: string; style: AnsiSpanStyle; highlight?: AnsiFindHighlight }> {
  if (!highlights || highlights.length === 0) {
    return spans.map((span, index) => ({
      key: `s-${index}`,
      text: span.text,
      style: span.style,
    }));
  }

  const sorted = [...highlights]
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Array<{
    key: string;
    text: string;
    style: AnsiSpanStyle;
    highlight?: AnsiFindHighlight;
  }> = [];
  let offset = 0;
  let piece = 0;

  for (const span of spans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    let cursor = spanStart;

    for (const highlight of sorted) {
      if (highlight.end <= spanStart || highlight.start >= spanEnd) continue;
      const cutStart = Math.max(cursor, highlight.start);
      const cutEnd = Math.min(spanEnd, highlight.end);
      if (cutStart > cursor) {
        out.push({
          key: `s-${piece++}`,
          text: span.text.slice(cursor - spanStart, cutStart - spanStart),
          style: span.style,
        });
      }
      if (cutEnd > cutStart) {
        out.push({
          key: `s-${piece++}`,
          text: span.text.slice(cutStart - spanStart, cutEnd - spanStart),
          style: span.style,
          highlight,
        });
      }
      cursor = Math.max(cursor, cutEnd);
    }

    if (cursor < spanEnd) {
      out.push({
        key: `s-${piece++}`,
        text: span.text.slice(cursor - spanStart),
        style: span.style,
      });
    }
    offset = spanEnd;
  }

  return out;
}

function AnsiSpanText({
  text,
  spanStyle,
  highlight,
  palette,
}: {
  text: string;
  spanStyle: AnsiSpanStyle;
  highlight?: AnsiFindHighlight;
  palette?: AnsiTerminalPalette;
}) {
  const style = useMemo(
    () => [spanToStyle(spanStyle, palette), highlightStyleFor(highlight)],
    [spanStyle, highlight, palette],
  );
  return <Text style={style}>{text}</Text>;
}

/**
 * Renders text that may contain ANSI SGR sequences using a terminal palette —
 * the same 16-color names xterm uses. Pass `palette` from
 * `resolveTerminalPalette(settings.terminalColorScheme, theme.colors.terminal)`
 * so shell cards track the user's terminal color scheme.
 */
export function AnsiText({
  text,
  style,
  findHighlights,
  selectable = true,
  palette,
  ligaturesEnabled,
}: AnsiTextProps) {
  const pieces = useMemo(() => {
    const spans = parseAnsiToSpans(text);
    return applyFindHighlights(spans, findHighlights);
  }, [text, findHighlights]);

  const rootStyle = useMemo(() => {
    const ligatures =
      ligaturesEnabled === undefined
        ? null
        : [monoLigatureTextStyle(ligaturesEnabled), monoLigatureInlineWebStyle(ligaturesEnabled)];
    const paletteColors = palette ? inlineUnistylesStyle({ color: palette.foreground }) : null;
    return [styles.base, paletteColors, ligatures, style];
  }, [style, palette, ligaturesEnabled]);

  const children: ReactNode[] = pieces.map((piece) => {
    if (!piece.text) return null;
    return (
      <AnsiSpanText
        key={piece.key}
        text={piece.text}
        spanStyle={piece.style}
        highlight={piece.highlight}
        palette={palette}
      />
    );
  });

  return (
    <Text selectable={selectable} style={rootStyle}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => {
  const term = theme.colors.terminal;
  return {
    base: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: term.foreground,
      lineHeight: Math.round(theme.fontSize.code * 1.5),
      // Ligatures follow theme.monoLigatures (synced from the terminal setting
      // via applyAppearance). Callers can still force on/off via ligaturesEnabled.
      ...monoLigatureTextStyle(theme.monoLigatures),
      ...(isWeb
        ? {
            whiteSpace: "pre-wrap" as const,
            overflowWrap: "anywhere" as const,
          }
        : null),
    },
    bold: {
      fontWeight: theme.fontWeight.semibold,
    },
    dim: {
      opacity: 0.65,
    },
    italic: {
      fontStyle: "italic",
    },
    underline: {
      textDecorationLine: "underline",
    },
    strikethrough: {
      textDecorationLine: "line-through",
    },
    fgBlack: { color: term.black },
    fgRed: { color: term.red },
    fgGreen: { color: term.green },
    fgYellow: { color: term.yellow },
    fgBlue: { color: term.blue },
    fgMagenta: { color: term.magenta },
    fgCyan: { color: term.cyan },
    fgWhite: { color: term.white },
    fgBrightBlack: { color: term.brightBlack },
    fgBrightRed: { color: term.brightRed },
    fgBrightGreen: { color: term.brightGreen },
    fgBrightYellow: { color: term.brightYellow },
    fgBrightBlue: { color: term.brightBlue },
    fgBrightMagenta: { color: term.brightMagenta },
    fgBrightCyan: { color: term.brightCyan },
    fgBrightWhite: { color: term.brightWhite },
    bgBlack: { backgroundColor: term.black },
    bgRed: { backgroundColor: term.red },
    bgGreen: { backgroundColor: term.green },
    bgYellow: { backgroundColor: term.yellow },
    bgBlue: { backgroundColor: term.blue },
    bgMagenta: { backgroundColor: term.magenta },
    bgCyan: { backgroundColor: term.cyan },
    bgWhite: { backgroundColor: term.white },
    bgBrightBlack: { backgroundColor: term.brightBlack },
    bgBrightRed: { backgroundColor: term.brightRed },
    bgBrightGreen: { backgroundColor: term.brightGreen },
    bgBrightYellow: { backgroundColor: term.brightYellow },
    bgBrightBlue: { backgroundColor: term.brightBlue },
    bgBrightMagenta: { backgroundColor: term.brightMagenta },
    bgBrightCyan: { backgroundColor: term.brightCyan },
    bgBrightWhite: { backgroundColor: term.brightWhite },
    hit: {
      backgroundColor:
        theme.colorScheme === "dark" ? "rgba(250, 204, 21, 0.32)" : "rgba(250, 204, 21, 0.38)",
    },
    hitCurrent: {
      backgroundColor:
        theme.colorScheme === "dark" ? "rgba(251, 146, 60, 0.58)" : "rgba(251, 146, 60, 0.48)",
    },
  };
});
