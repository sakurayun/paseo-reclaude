import { LogIn, LogOut, RefreshCw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ReclaudeLoginModal } from "./reclaude-login-modal";
import { useReclaude } from "./use-reclaude";

// Sign-in + manual sync affordance for the Claude usage card when the Claude
// provider is run via reclaude. Renders nothing unless reclaude is the active
// binary. The "sync usage" button is the ONLY trigger that live-fetches usage
// from reclaude.ai — the section's top refresh button never does.
export function ReclaudeAuthBar({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { supported, active, loggedIn, email, logout, syncUsage } = useReclaude(serverId);
  const [modalVisible, setModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  const handleLogout = useCallback(() => {
    if (loggingOut) return;
    setLoggingOut(true);
    logout()
      .catch((err) => {
        Alert.alert(
          t("providerUsage.reclaude.logoutError"),
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => setLoggingOut(false));
  }, [loggingOut, logout, t]);

  const handleSync = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    // Explicit button press always pulls fresh data (bypasses the 5-min throttle).
    syncUsage({ force: true })
      .catch((err) => {
        Alert.alert(
          t("providerUsage.reclaude.syncError"),
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => setSyncing(false));
  }, [syncing, syncUsage, t]);

  if (!supported || !active) {
    return null;
  }

  return (
    <View style={styles.container}>
      {loggedIn ? (
        <>
          <Text style={styles.statusText} numberOfLines={1}>
            {email
              ? t("providerUsage.reclaude.loggedInAs", { email })
              : t("providerUsage.reclaude.loggedIn")}
          </Text>
          <View style={styles.buttons}>
            <Button
              variant="outline"
              size="sm"
              leftIcon={RefreshCw}
              onPress={handleSync}
              disabled={syncing}
              loading={syncing}
              accessibilityLabel={t("providerUsage.reclaude.sync")}
              testID="reclaude-sync-button"
            >
              {syncing ? t("providerUsage.reclaude.syncing") : t("providerUsage.reclaude.sync")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={LogOut}
              onPress={handleLogout}
              disabled={loggingOut}
              loading={loggingOut}
              accessibilityLabel={t("providerUsage.reclaude.logout")}
            >
              {t("providerUsage.reclaude.logout")}
            </Button>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.statusText} numberOfLines={2}>
            {t("providerUsage.reclaude.needLogin")}
          </Text>
          <Button
            variant="outline"
            size="sm"
            leftIcon={LogIn}
            onPress={openModal}
            accessibilityLabel={t("providerUsage.reclaude.loginButton")}
            testID="reclaude-login-button"
          >
            {t("providerUsage.reclaude.loginButton")}
          </Button>
        </>
      )}

      <ReclaudeLoginModal
        serverId={serverId}
        visible={modalVisible}
        onClose={closeModal}
        onSuccess={handleSync}
      />
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
    // Sits directly under the Claude card; align with the card's inner padding
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
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
