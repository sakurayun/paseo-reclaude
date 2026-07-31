import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Theme } from "@/styles/theme";
import { ProviderUsageBalanceBar } from "./balance-bar";
import { formatAgo } from "./format";
import { localizeProviderUsage } from "./localize";
import { ProviderUsageSourceTabs } from "./source-tabs";
import type { ProviderUsage, ProviderUsageSource, ProviderUsageSourceKind } from "./types";
import { ProviderUsageWindowBar } from "./window-bar";

interface ProviderUsageIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function ProviderUsageIcon({ iconKey, size, color = "" }: ProviderUsageIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedProviderUsageIcon = withUnistyles(ProviderUsageIcon);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const EMPTY_SOURCES: NonNullable<ProviderUsage["sources"]> = [];

function statusText(
  usage: ProviderUsage,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (usage.status === "available") return null;
  return usage.status === "error"
    ? t("providerUsage.status.error")
    : t("providerUsage.status.unavailable");
}

function footerText(
  usage: ProviderUsage,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  const updated = formatAgo(usage.fetchedAt, t);
  if (usage.sourceLabel && updated) {
    return t("providerUsage.footer.sourceUpdated", {
      source: usage.sourceLabel,
      time: updated,
    });
  }
  if (updated) {
    return t("providerUsage.footer.updated", { time: updated });
  }
  return usage.sourceLabel || null;
}

function projectSourceOntoUsage(base: ProviderUsage, source: ProviderUsageSource): ProviderUsage {
  return {
    ...base,
    status: source.status,
    planLabel: source.planLabel,
    sourceLabel: source.label,
    windows: source.windows,
    balances: source.balances,
    details: source.details,
    error: source.error ?? null,
    selectedSourceKind: source.kind,
  };
}

function pickDefaultSourceKind(usage: ProviderUsage): ProviderUsageSourceKind | null {
  if (usage.selectedSourceKind) return usage.selectedSourceKind;
  const sources = usage.sources ?? [];
  if (sources.length === 0) return null;
  const available = sources.find((source) => source.status === "available");
  return available?.kind ?? sources[0]?.kind ?? null;
}

export function ProviderUsageCard({
  usage,
  compact = false,
}: {
  usage: ProviderUsage;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const sources = usage.sources ?? EMPTY_SOURCES;
  const showSourceTabs =
    (usage.providerId === "claude" || usage.providerId === "codex") && sources.length > 1;

  const [selectedKind, setSelectedKind] = useState<ProviderUsageSourceKind | null>(() =>
    pickDefaultSourceKind(usage),
  );

  // Keep selection in sync when a refresh returns a new preferred source, but
  // don't clobber a manual tab choice that still exists in the new payload.
  useEffect(() => {
    setSelectedKind((prev) => {
      if (prev && sources.some((source) => source.kind === prev)) {
        return prev;
      }
      return pickDefaultSourceKind(usage);
    });
  }, [usage, sources]);

  const activeSource = useMemo(() => {
    if (!selectedKind) return null;
    return sources.find((source) => source.kind === selectedKind) ?? null;
  }, [selectedKind, sources]);

  const projected = useMemo(() => {
    if (!activeSource) return usage;
    return projectSourceOntoUsage(usage, activeSource);
  }, [activeSource, usage]);

  // Server labels are English protocol strings — localize known ids for the UI.
  const localized = useMemo(
    () => localizeProviderUsage(projected, t, i18n.language),
    [i18n.language, projected, t],
  );
  const status = statusText(localized, t);
  const footer = footerText(localized, t);
  const balances = localized.balances ?? [];
  const details = useMemo(() => {
    const all = localized.details ?? [];
    if (!compact) return all;
    // Compact tooltip: keep the high-signal rows (plan + reset) and drop long
    // absolute timestamps so weekly/monthly bars stay primary.
    return all.filter(
      (detail) =>
        detail.id === "subscription" ||
        detail.id === "current_period" ||
        detail.id === "previous_cycle",
    );
  }, [compact, localized.details]);
  const containerStyle = useMemo(
    () => [styles.container, compact ? styles.containerCompact : styles.containerPadded],
    [compact],
  );
  const dotStyle = useMemo(
    () => [
      styles.statusDot,
      localized.status === "available" && styles.statusDotAvailable,
      localized.status === "error" && styles.statusDotError,
    ],
    [localized.status],
  );

  const handleSelectSource = useCallback((kind: ProviderUsageSourceKind) => {
    setSelectedKind(kind);
  }, []);

  return (
    <View style={containerStyle} testID={`provider-usage-card-${usage.providerId}`}>
      <View style={styles.header}>
        <ThemedProviderUsageIcon
          iconKey={localized.providerId}
          size={14}
          uniProps={mutedIconColor}
        />
        <Text style={styles.name} numberOfLines={1}>
          {localized.displayName}
        </Text>
        {localized.planLabel ? <StatusBadge label={localized.planLabel} variant="muted" /> : null}
        <View style={styles.headerSpacer} />
        {status ? (
          <View style={styles.statusRow}>
            <View style={dotStyle} />
            <Text style={styles.statusLabel}>{status}</Text>
          </View>
        ) : null}
      </View>
      {showSourceTabs && selectedKind ? (
        <ProviderUsageSourceTabs
          sources={sources}
          selectedKind={selectedKind}
          onSelect={handleSelectSource}
        />
      ) : null}
      {localized.error ? (
        <Text style={styles.error} numberOfLines={4}>
          {localized.error}
        </Text>
      ) : null}
      {localized.windows.length > 0 || balances.length > 0 ? (
        <View style={styles.bars}>
          {localized.windows.map((window) => (
            <ProviderUsageWindowBar key={window.id} window={window} />
          ))}
          {balances.map((balance) => (
            <ProviderUsageBalanceBar key={balance.id} balance={balance} />
          ))}
        </View>
      ) : null}
      {details.length > 0 ? (
        <View style={styles.details}>
          {details.map((detail) => (
            <View key={detail.id} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{detail.label}</Text>
              <Text style={styles.detailValue}>{detail.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  containerPadded: {
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  containerCompact: {
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  headerSpacer: {
    flex: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusDotAvailable: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotError: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  bars: {
    gap: theme.spacing[3],
  },
  details: {
    gap: theme.spacing[1],
  },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailLabel: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  detailValue: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    textAlign: "right",
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  footer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
