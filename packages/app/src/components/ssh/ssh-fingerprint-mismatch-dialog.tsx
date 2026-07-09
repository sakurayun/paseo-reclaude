import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { SshObservedHostKey } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

interface SshFingerprintMismatchDialogProps {
  observedKey: SshObservedHostKey | null;
  isBusy: boolean;
  onTrust: () => void;
  onClose: () => void;
}

// TOFU mismatch confirmation: shown when a connect attempt is rejected because
// the host key changed. Trusting replaces the stored fingerprint and the caller
// reconnects.
export function SshFingerprintMismatchDialog({
  observedKey,
  isBusy,
  onTrust,
  onClose,
}: SshFingerprintMismatchDialogProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("ssh.hosts.hostKeyMismatchTitle") }), [t]);
  const handleTrust = useCallback(() => onTrust(), [onTrust]);
  const hostLabel = formatHostLabel(observedKey);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" style={styles.footerButton} onPress={onClose} disabled={isBusy}>
          {t("ssh.form.cancel")}
        </Button>
        <Button
          variant="destructive"
          style={styles.footerButton}
          onPress={handleTrust}
          loading={isBusy}
          testID="ssh-mismatch-trust"
        >
          {t("ssh.hosts.hostKeyMismatchConfirm")}
        </Button>
      </View>
    ),
    [handleTrust, isBusy, onClose, t],
  );

  if (!observedKey) {
    return null;
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      testID="ssh-mismatch-dialog"
    >
      <View style={styles.body}>
        <Text style={styles.message}>
          {t("ssh.hosts.hostKeyMismatchBody", { host: hostLabel })}
        </Text>
        <View style={styles.fingerprintBox}>
          <Text style={styles.fingerprintLabel}>{observedKey.keyType}</Text>
          <Text style={styles.fingerprint}>{observedKey.fingerprintSha256}</Text>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function formatHostLabel(observedKey: SshObservedHostKey | null): string {
  if (!observedKey) {
    return "";
  }
  return observedKey.port ? `${observedKey.host}:${observedKey.port}` : observedKey.host;
}

const styles = StyleSheet.create((theme: Theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  message: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  fingerprintBox: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fingerprintLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fingerprint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
  },
  footer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
