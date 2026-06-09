import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getActiveLocale, useLocale } from "@/i18n/use-locale";

interface DiffStatProps {
  additions: number;
  deletions: number;
}

// Locale-keyed compact formatters so "1.2k" follows the active language.
const compactFormatters = new Map<string, Intl.NumberFormat>();
function getCompactFormatter(locale: string): Intl.NumberFormat {
  let formatter = compactFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactFormatters.set(locale, formatter);
  }
  return formatter;
}

export function formatDiffCount(value: number): string {
  return getCompactFormatter(getActiveLocale()).format(value).toLowerCase();
}

export function DiffStat({ additions, deletions }: DiffStatProps) {
  // Subscribe to language changes so the compact counts re-render in the active locale.
  useLocale();
  return (
    <View style={styles.row}>
      <Text style={styles.additions}>+{formatDiffCount(additions)}</Text>
      <Text style={styles.deletions}>-{formatDiffCount(deletions)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
}));
