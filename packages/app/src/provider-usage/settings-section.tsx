import { RefreshCw } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  useAppSettings,
  type GrokUsageRefreshIntervalMinutes,
  type ProviderUsageMeterPercentageMode,
} from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { ProviderUsageList } from "./list";
import type { ProviderUsageView } from "./types";

const GROK_INTERVAL_OPTIONS: readonly GrokUsageRefreshIntervalMinutes[] = [0, 1, 5, 15, 30];

export function ProviderUsageSettingsSection({
  view,
  onRefresh,
  serverId,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
  serverId: string;
}) {
  const { t } = useTranslation();
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        loading={busy}
        onPress={onRefresh}
        accessibilityLabel={t("providerUsage.refresh")}
      >
        {busy ? t("providerUsage.refreshing") : t("providerUsage.refresh")}
      </Button>
    ),
    [busy, onRefresh, t],
  );

  return (
    <SettingsSection
      title={t("providerUsage.title")}
      testID="provider-usage-card"
      trailing={refreshButton}
    >
      <ProviderUsageMeterDisplaySettings />
      <GrokAutoRefreshSettings serverId={serverId} />
      <ProviderUsageBody view={view} onRefresh={onRefresh} serverId={serverId} />
    </SettingsSection>
  );
}

function ProviderUsageMeterDisplaySettings() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const mode = settings.providerUsageMeterPercentageMode;

  const options = useMemo(
    () => [
      {
        value: "used" as const,
        label: t("providerUsage.meter.percentageMode.used"),
        testID: "provider-usage-meter-mode-used",
      },
      {
        value: "remaining" as const,
        label: t("providerUsage.meter.percentageMode.remaining"),
        testID: "provider-usage-meter-mode-remaining",
      },
    ],
    [t],
  );

  const handleChange = useCallback(
    (value: ProviderUsageMeterPercentageMode) => {
      void updateSettings({ providerUsageMeterPercentageMode: value });
    },
    [updateSettings],
  );

  return (
    <View
      style={[settingsStyles.card, styles.intervalCard]}
      testID="provider-usage-meter-display-settings"
    >
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("providerUsage.meter.percentageMode.label")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("providerUsage.meter.percentageMode.description")}
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          value={mode}
          onValueChange={handleChange}
          options={options}
          testID="provider-usage-meter-mode-control"
        />
      </View>
    </View>
  );
}

function GrokIntervalMenuItem({
  value,
  selected,
  onSelect,
  label,
}: {
  value: GrokUsageRefreshIntervalMinutes;
  selected: boolean;
  onSelect: (value: GrokUsageRefreshIntervalMinutes) => void;
  label: string;
}) {
  const handleSelect = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GrokAutoRefreshSettings({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const grokSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.grokUsageSync === true,
  );

  const interval = settings.grokUsageRefreshIntervalMinutes;
  const selectedLabel = formatGrokIntervalLabel(interval, t);

  const handleSelect = useCallback(
    (value: GrokUsageRefreshIntervalMinutes) => {
      void updateSettings({ grokUsageRefreshIntervalMinutes: value });
    },
    [updateSettings],
  );

  if (!grokSupported) {
    return null;
  }

  return (
    <View style={[settingsStyles.card, styles.intervalCard]} testID="grok-usage-refresh-settings">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("providerUsage.grok.refreshInterval.label")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("providerUsage.grok.refreshInterval.description")}
          </Text>
        </View>
        <DropdownMenu>
          <DropdownTrigger
            accessibilityRole="button"
            accessibilityLabel={selectedLabel}
            style={styles.intervalTrigger}
            testID="grok-usage-refresh-interval-trigger"
          >
            <Text style={styles.intervalTriggerText}>{selectedLabel}</Text>
          </DropdownTrigger>
          <DropdownMenuContent side="bottom" align="end" width={180}>
            {GROK_INTERVAL_OPTIONS.map((value) => (
              <GrokIntervalMenuItem
                key={value}
                value={value}
                selected={value === interval}
                onSelect={handleSelect}
                label={formatGrokIntervalLabel(value, t)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}

function formatGrokIntervalLabel(
  minutes: GrokUsageRefreshIntervalMinutes,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (minutes === 0) {
    return t("providerUsage.grok.refreshInterval.off");
  }
  return t("providerUsage.grok.refreshInterval.minutes", { count: minutes });
}

function ProviderUsageBody({
  view,
  onRefresh,
  serverId,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
  serverId: string;
}) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{t("providerUsage.loading")}</Text>
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert variant="error" title={t("providerUsage.errorTitle")} description={view.message}>
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("providerUsage.retry")}
        </Button>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{t("providerUsage.empty")}</Text>
      </View>
    );
  }

  return <ProviderUsageList providers={view.payload.providers} serverId={serverId} />;
}

const styles = StyleSheet.create((theme) => ({
  intervalCard: {
    marginBottom: theme.spacing[3],
  },
  intervalTrigger: {
    minWidth: 88,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
  },
  intervalTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.cardSurface, styles.emptyCard];
