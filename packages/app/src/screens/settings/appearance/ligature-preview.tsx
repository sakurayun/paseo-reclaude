import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { monoLigatureInlineWebStyle } from "@/styles/mono-ligatures";
import { DEFAULT_MONO_FONT_STACK } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

// Fixed programming sequences that coding fonts with ligatures typically fuse
// (Fira Code, Cascadia Code, Maple Mono, etc.). Not executed — display only.
const LIGATURE_PREVIEW_LINES = [
  "const sum = (a, b) => a + b;",
  "const ok = x !== null && x <= max;",
  "if (left == right) return a >= b;",
  "const map = items.map(x => x * 2);",
  "// arrows: a -> b   equality: a === b",
  "const pipe = src --> dest !== null;",
] as const;

interface PreviewOverrides {
  monoFontFamily?: string;
  codeFontSize?: number;
}

interface LigaturePreviewProps {
  // Mirrors the terminal ligatures setting — on enables liga/calt, off disables them.
  enabled: boolean;
  // Live drafts for code font (same while-typing path as AppearancePreview).
  overrides?: PreviewOverrides;
}

function resolveFamilyOverride(value: string | undefined, fallback: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function buildCodeOverride(overrides: PreviewOverrides | undefined, enabled: boolean): TextStyle {
  const style: TextStyle = {};
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

// Code-block preview under the Font ligatures toggle. Shows the same sequences
// terminals would fuse when the mono font supports them, and follows the live
// code-font drafts so users can verify family + ligature together.
export function LigaturePreview({ enabled, overrides }: LigaturePreviewProps) {
  const { t } = useTranslation();
  const codeOverride = useMemo(() => buildCodeOverride(overrides, enabled), [enabled, overrides]);
  const codeStyle = useMemo(() => [styles.codeLine, codeOverride], [codeOverride]);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("settings.appearance.terminal.ligaturesPreviewAccessibility")}
      dataSet={CODE_SURFACE_DATASET}
      style={styles.card}
    >
      <Text style={styles.caption}>
        {enabled
          ? t("settings.appearance.terminal.ligaturesPreviewOn")
          : t("settings.appearance.terminal.ligaturesPreviewOff")}
      </Text>
      <View style={styles.codeBlock}>
        {LIGATURE_PREVIEW_LINES.map((line) => (
          <Text key={line} style={codeStyle}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

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
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  codeBlock: {
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[1],
  },
  codeLine: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    color: theme.colors.foreground,
    ...(isWeb ? { whiteSpace: "pre", overflowWrap: "normal" } : null),
  },
}));
