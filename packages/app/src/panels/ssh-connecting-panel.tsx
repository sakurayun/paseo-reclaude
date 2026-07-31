import { useCallback, useMemo, useRef, useState, type ComponentType } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { TextInput } from "react-native";
import { CircleAlert, ShieldAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelIconProps, PanelRegistration } from "@/panels/panel-registry";
import { OsBadge } from "@/components/ssh/os-badge";
import { FormTextInput } from "@/components/ui/form-field";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useSshConnectState } from "@/stores/ssh-connect-store";
import {
  cancelSshConnect,
  reconnectSshConnect,
  retrySshConnect,
  trustAndReconnectConnect,
} from "@/screens/ssh/run-ssh-connect";
import type { Theme } from "@/styles/theme";

function useSshConnectingPanelDescriptor(target: {
  kind: "ssh-connecting";
  connectId: string;
}): PanelDescriptor {
  const { t } = useTranslation();
  const state = useSshConnectState(target.connectId);
  const failed =
    state?.status === "auth_failed" || state?.status === "mismatch" || state?.status === "error";

  const icon = useMemo<ComponentType<PanelIconProps>>(() => {
    const os = state?.os ?? null;
    return function SshConnectingTabIcon({ size }: PanelIconProps) {
      return <OsBadge os={os} size={size} />;
    };
  }, [state?.os]);

  return {
    label: state?.label ?? t("ssh.connect.tabLabel"),
    tooltip: state?.label ?? t("ssh.connect.tabLabel"),
    subtitle: t("ssh.connect.tabLabel"),
    titleState: "ready",
    icon,
    statusBucket: failed ? "failed" : "running",
  };
}

function SshConnectingPanel() {
  const { t } = useTranslation();
  const { target } = usePaneContext();
  invariant(target.kind === "ssh-connecting", "SshConnectingPanel requires ssh-connecting target");
  const state = useSshConnectState(target.connectId);
  const connectId = target.connectId;

  const [password, setPassword] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const logScrollRef = useRef<ScrollView>(null);

  const handleClose = useCallback(() => cancelSshConnect(connectId), [connectId]);
  const handleRetry = useCallback(() => reconnectSshConnect(connectId), [connectId]);
  const handleTrust = useCallback(() => trustAndReconnectConnect(connectId), [connectId]);
  const scrollLogToEnd = useCallback(() => {
    logScrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const handleSubmitPassword = useCallback(() => {
    if (password.trim().length === 0) {
      return;
    }
    retrySshConnect(connectId, password);
    setPassword("");
  }, [connectId, password]);

  const logText = useMemo(
    () => (state ? state.log.map((entry) => entry.line).join("\n") : ""),
    [state],
  );

  // No store entry: the attempt ended on this device or arrived from a reload.
  if (!state) {
    return (
      <View style={styles.centered}>
        <Text style={styles.endedText}>{t("ssh.connect.ended")}</Text>
        <Pressable style={styles.secondaryButton} onPress={handleClose} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>{t("ssh.connect.close")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <OsBadge os={state.os} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.headerLabel} numberOfLines={1}>
            {state.label}
          </Text>
          <Text style={styles.headerStatus} numberOfLines={1}>
            {resolveStatusLabel(state.status, t)}
          </Text>
        </View>
        {state.status === "connecting" ? (
          <ThemedActivityIndicator size="small" uniProps={mutedColorMapping} />
        ) : null}
      </View>

      {logText.length > 0 ? (
        <ScrollView
          ref={logScrollRef}
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
          onContentSizeChange={scrollLogToEnd}
          testID="ssh-connect-log"
        >
          <Text selectable dataSet={CODE_SURFACE_DATASET} style={styles.logText}>
            {logText}
          </Text>
        </ScrollView>
      ) : null}

      {state.status === "auth_failed" ? (
        <View style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <ThemedCircleAlert size={16} uniProps={redColorMapping} />
            <Text style={styles.actionTitle}>{t("ssh.connect.authFailed")}</Text>
          </View>
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          <FormTextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleSubmitPassword}
            placeholder={t("ssh.connect.passwordPlaceholder")}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID="ssh-connect-password"
          />
          <Pressable
            style={styles.primaryButton}
            onPress={handleSubmitPassword}
            accessibilityRole="button"
            testID="ssh-connect-password-submit"
          >
            <Text style={styles.primaryButtonText}>{t("ssh.connect.confirm")}</Text>
          </Pressable>
        </View>
      ) : null}

      {state.status === "mismatch" ? (
        <View style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <ThemedShieldAlert size={16} uniProps={redColorMapping} />
            <Text style={styles.actionTitle}>{t("ssh.connect.mismatchTitle")}</Text>
          </View>
          <Text style={styles.errorText}>{t("ssh.connect.mismatchMessage")}</Text>
          {state.observedKey ? (
            <Text selectable style={styles.fingerprint}>
              {state.observedKey.keyType} {state.observedKey.fingerprintSha256}
            </Text>
          ) : null}
          <Pressable
            style={styles.primaryButton}
            onPress={handleTrust}
            accessibilityRole="button"
            testID="ssh-connect-trust"
          >
            <Text style={styles.primaryButtonText}>{t("ssh.connect.trust")}</Text>
          </Pressable>
        </View>
      ) : null}

      {state.status === "error" ? (
        <View style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <ThemedCircleAlert size={16} uniProps={redColorMapping} />
            <Text style={styles.actionTitle}>
              {isHandshakeFailure(state.error, logText)
                ? t("ssh.connect.handshakeHintTitle")
                : t("ssh.connect.errorTitle")}
            </Text>
          </View>
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          {isHandshakeFailure(state.error, logText) ? (
            <Text style={styles.errorText}>{t("ssh.connect.handshakeHintBody")}</Text>
          ) : null}
          <View style={styles.buttonRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={handleRetry}
              accessibilityRole="button"
              testID="ssh-connect-retry"
            >
              <Text style={styles.primaryButtonText}>{t("ssh.connect.retry")}</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={handleClose}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>{t("ssh.connect.close")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function resolveStatusLabel(status: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (status === "auth_failed") return t("ssh.connect.authFailed");
  if (status === "mismatch") return t("ssh.connect.mismatchTitle");
  if (status === "error") return t("ssh.connect.errorTitle");
  return t("ssh.connect.connecting");
}

function isHandshakeFailure(error: string | null | undefined, logText: string): boolean {
  const haystack = `${error ?? ""}\n${logText}`;
  return /connection lost before handshake|kex_exchange_identification|before the SSH protocol|no server banner/i.test(
    haystack,
  );
}

export const sshConnectingPanelRegistration: PanelRegistration<"ssh-connecting"> = {
  kind: "ssh-connecting",
  component: SshConnectingPanel,
  useDescriptor: useSshConnectingPanelDescriptor,
};

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedShieldAlert = withUnistyles(ShieldAlert);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
  endedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  headerStatus: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  logScroll: {
    maxHeight: 260,
    borderRadius: theme.borderRadius.lg,
    // borderless card (new theme)
    ...theme.shadow.sm,
    backgroundColor: theme.colors.surface1,
  },
  logContent: {
    padding: theme.spacing[3],
  },
  logText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: Math.round(theme.fontSize.code * 1.6),
    color: theme.colors.foreground,
  },
  actionCard: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    // borderless card (new theme)
    ...theme.shadow.sm,
    backgroundColor: theme.colors.surface1,
  },
  actionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.palette.red[600],
  },
  fingerprint: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  buttonRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  primaryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  primaryButtonText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    // borderless card (new theme)
    ...theme.shadow.sm,
  },
  secondaryButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
