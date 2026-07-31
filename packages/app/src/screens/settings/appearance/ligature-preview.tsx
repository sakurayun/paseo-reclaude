import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { HighlightToken } from "@getpaseo/highlight";
import {
  resolveTerminalPalette,
  type TerminalColorSchemeId,
} from "@/constants/terminal-color-presets";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { monoLigatureInlineWebStyle, monoLigatureTextStyle } from "@/styles/mono-ligatures";
import { DEFAULT_MONO_FONT_STACK, type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { tokenizeToLines } from "@/utils/highlight-cache";
import { terminalColorForSyntaxStyle, type TerminalPalette } from "./ligature-preview-palette";

// Fixed programming sequences that coding fonts with ligatures typically fuse
// (Fira Code, Cascadia Code, Maple Mono, etc.). Not executed — display only.
// Tokenized as TypeScript; colors come from the terminal color scheme palette.
const LIGATURE_PREVIEW_LINES = [
  "const sum = (a, b) => a + b;",
  "const ok = x !== null && x <= max;",
  "if (left == right) return a >= b;",
  "const map = items.map(x => x * 2);",
  "// arrows: a -> b   equality: a === b",
  "const pipe = src --> dest !== null;",
] as const;

const PREVIEW_EXTENSION = "ts";
const PREVIEW_SOURCE = LIGATURE_PREVIEW_LINES.join("\n");
const ZERO_WIDTH = "​";

interface PreviewOverrides {
  monoFontFamily?: string;
  codeFontSize?: number;
}

interface LigaturePreviewProps {
  // Mirrors the terminal ligatures setting — on enables liga/calt, off disables them.
  enabled: boolean;
  // Active terminal color scheme (same control as the Terminal section dropdown).
  terminalColorScheme: TerminalColorSchemeId;
  // Live drafts for code font (same while-typing path as AppearancePreview).
  overrides?: PreviewOverrides;
}

interface LigaturePreviewThemeProps {
  themeTerminal: TerminalPalette;
}

interface KeyedToken {
  key: string;
  style: string | null;
  text: string;
}

interface PreviewLine {
  key: string;
  tokens: KeyedToken[] | null;
  fallbackText: string;
}

function resolveFamilyOverride(value: string | undefined, fallback: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function buildCodeOverride(
  overrides: PreviewOverrides | undefined,
  enabled: boolean,
  palette: TerminalPalette,
): TextStyle {
  const style: TextStyle = {
    color: palette.foreground,
  };
  const fontFamily = resolveFamilyOverride(overrides?.monoFontFamily, DEFAULT_MONO_FONT_STACK);
  if (fontFamily !== undefined) {
    style.fontFamily = fontFamily;
  }
  const fontSize = overrides?.codeFontSize;
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    style.fontSize = fontSize;
    style.lineHeight = Math.round(fontSize * 1.5);
  }
  Object.assign(style, monoLigatureInlineWebStyle(enabled));
  return inlineUnistylesStyle(style);
}

function mapTokens(
  lineIndex: number,
  raw: HighlightToken[] | null | undefined,
): KeyedToken[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((token, index) => ({
    key: `${lineIndex}-${index}`,
    style: token.style,
    text: token.text,
  }));
}

function buildPreviewLines(): PreviewLine[] {
  const tokenized = tokenizeToLines(PREVIEW_SOURCE, PREVIEW_EXTENSION);
  return LIGATURE_PREVIEW_LINES.map((line, index) => ({
    key: `lig-${index}`,
    tokens: mapTokens(index, tokenized?.[index]),
    fallbackText: line.length > 0 ? line : ZERO_WIDTH,
  }));
}

function LigaturePreviewBase({
  enabled,
  terminalColorScheme,
  overrides,
  themeTerminal,
}: LigaturePreviewProps & LigaturePreviewThemeProps) {
  const { t } = useTranslation();
  const lines = useMemo(() => buildPreviewLines(), []);

  const palette = useMemo(
    () => resolveTerminalPalette(terminalColorScheme, themeTerminal),
    [terminalColorScheme, themeTerminal],
  );

  const codeOverride = useMemo(
    () => buildCodeOverride(overrides, enabled, palette),
    [enabled, overrides, palette],
  );

  const codeStyle = useMemo(
    () => [styles.codeLine, enabled ? styles.ligaturesOn : styles.ligaturesOff, codeOverride],
    [codeOverride, enabled],
  );

  const codeBlockStyle = useMemo(
    () => [
      styles.codeBlock,
      inlineUnistylesStyle({
        backgroundColor: palette.background,
        // Thin selection-tinted edge so the terminal surface reads as a pane.
        borderColor: palette.selectionBackground,
      }),
    ],
    [palette.background, palette.selectionBackground],
  );

  const captionStyle = useMemo(
    () => [styles.caption, inlineUnistylesStyle({ color: palette.brightBlack })],
    [palette.brightBlack],
  );

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("settings.appearance.terminal.ligaturesPreviewAccessibility")}
      dataSet={CODE_SURFACE_DATASET}
      style={styles.card}
    >
      <Text style={captionStyle}>
        {enabled
          ? t("settings.appearance.terminal.ligaturesPreviewOn")
          : t("settings.appearance.terminal.ligaturesPreviewOff")}
      </Text>
      <View style={codeBlockStyle}>
        {lines.map((line) => (
          <Text key={line.key} style={codeStyle}>
            {line.tokens
              ? line.tokens.map((token) => (
                  <Text
                    key={token.key}
                    style={inlineUnistylesStyle({
                      color: terminalColorForSyntaxStyle(token.style, palette),
                    })}
                  >
                    {token.text}
                  </Text>
                ))
              : line.fallbackText}
          </Text>
        ))}
      </View>
    </View>
  );
}

// Inject theme terminal palette without useUnistyles (banned). Only this leaf
// re-renders when the app theme's terminal defaults change; scheme id is a prop.
export const LigaturePreview = withUnistyles(LigaturePreviewBase, (theme: Theme) => ({
  themeTerminal: theme.colors.terminal,
}));

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
    ...theme.shadow.sm,
  },
  caption: {
    fontSize: theme.fontSize.xs,
  },
  codeBlock: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.shell.controlBorder,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[1],
  },
  codeLine: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    ...monoLigatureTextStyle(theme.monoLigatures),
    ...(isWeb ? { whiteSpace: "pre", overflowWrap: "normal" } : null),
  },
  ligaturesOn: monoLigatureTextStyle(true),
  ligaturesOff: monoLigatureTextStyle(false),
}));
