import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderUsageSource, ProviderUsageSourceKind } from "./types";

const SOURCE_ORDER: ProviderUsageSourceKind[] = ["official", "newapi", "sub2api", "cpa"];
const ACCESSIBILITY_STATE_SELECTED = { selected: true } as const;
const ACCESSIBILITY_STATE_UNSELECTED = { selected: false } as const;

function sourceLabel(
  kind: ProviderUsageSourceKind,
  fallback: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (kind) {
    case "official":
      return t("providerUsage.sources.official");
    case "newapi":
      return t("providerUsage.sources.newapi");
    case "sub2api":
      return t("providerUsage.sources.sub2api");
    case "cpa":
      return t("providerUsage.sources.cpa");
    default:
      return fallback;
  }
}

export function ProviderUsageSourceTabs({
  sources,
  selectedKind,
  onSelect,
}: {
  sources: ProviderUsageSource[];
  selectedKind: ProviderUsageSourceKind;
  onSelect: (kind: ProviderUsageSourceKind) => void;
}) {
  const { t } = useTranslation();

  const ordered = useMemo(() => {
    const byKind = new Map(sources.map((source) => [source.kind, source]));
    return SOURCE_ORDER.flatMap((kind) => {
      const source = byKind.get(kind);
      return source ? [source] : [];
    });
  }, [sources]);

  if (ordered.length <= 1) {
    return null;
  }

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {ordered.map((source) => (
        <SourceTab
          key={source.kind}
          source={source}
          selected={source.kind === selectedKind}
          label={sourceLabel(source.kind, source.label, t)}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function SourceTab({
  source,
  selected,
  label,
  onSelect,
}: {
  source: ProviderUsageSource;
  selected: boolean;
  label: string;
  onSelect: (kind: ProviderUsageSourceKind) => void;
}) {
  const handlePress = useCallback(() => onSelect(source.kind), [onSelect, source.kind]);
  const tabStyle = useMemo(
    () => [
      styles.tab,
      selected && styles.tabSelected,
      source.status === "available" && styles.tabAvailable,
      source.status === "error" && styles.tabError,
    ],
    [selected, source.status],
  );
  const labelStyle = useMemo(
    () => [styles.tabLabel, selected && styles.tabLabelSelected],
    [selected],
  );
  const accessibilityState = selected
    ? ACCESSIBILITY_STATE_SELECTED
    : ACCESSIBILITY_STATE_UNSELECTED;

  return (
    <Pressable
      style={tabStyle}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`provider-usage-source-tab-${source.kind}`}
    >
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  tab: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    // borderless card (new theme)
    ...theme.shadow.sm,
    backgroundColor: theme.colors.surface1,
  },
  tabSelected: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
  tabAvailable: {},
  tabError: {
    borderColor: theme.colors.palette.red[300],
  },
  tabLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
  },
}));
