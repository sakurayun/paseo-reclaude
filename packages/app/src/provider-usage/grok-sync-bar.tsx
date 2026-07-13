import { RefreshCw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useGrok } from "./use-grok";

// Manual sync affordance for the Grok Build usage card. Auth is external
// (`grok login` / XAI_API_KEY); this bar only triggers a live billing pull.
// The section's top refresh button never hits the Grok billing API.
export function GrokSyncBar({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { supported, authenticated, syncUsage } = useGrok(serverId);
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    // Explicit button press always pulls fresh data (bypasses the 5-min throttle).
    syncUsage({ force: true })
      .catch((err) => {
        Alert.alert(
          t("providerUsage.grok.syncError"),
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => setSyncing(false));
  }, [syncing, syncUsage, t]);

  if (!supported) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.statusText} numberOfLines={2}>
        {authenticated ? t("providerUsage.grok.authenticated") : t("providerUsage.grok.needAuth")}
      </Text>
      <Button
        variant="outline"
        size="sm"
        leftIcon={RefreshCw}
        onPress={handleSync}
        disabled={syncing}
        loading={syncing}
        accessibilityLabel={t("providerUsage.grok.sync")}
        testID="grok-sync-button"
      >
        {syncing ? t("providerUsage.grok.syncing") : t("providerUsage.grok.sync")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Sits directly under the Grok card; align with the card's inner padding
    // and pull up under its bottom padding so it reads as one unit.
    marginTop: -theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  statusText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
