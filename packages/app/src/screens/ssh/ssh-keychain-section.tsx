import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { KeyRound, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSshKeys } from "@/screens/ssh/use-ssh-keys";
import type { SshKeyInfo } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

interface SshKeychainSectionProps {
  serverId: string | null;
}

export function SshKeychainSection({ serverId }: SshKeychainSectionProps) {
  const { t } = useTranslation();
  const { keys, deleteKey } = useSshKeys(serverId);
  const [creating, setCreating] = useState(false);
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);

  return (
    <View style={styles.section}>
      <View style={styles.toolbar}>
        <Button variant="secondary" onPress={openCreate} testID="ssh-new-key">
          {t("ssh.keychain.newKey")}
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {keys.length === 0 ? (
          <Text style={styles.empty}>{t("ssh.keychain.empty")}</Text>
        ) : (
          keys.map((key) => <KeyRow key={key.id} sshKey={key} onDelete={deleteKey} />)
        )}
      </ScrollView>
      {creating ? <NewKeySheet serverId={serverId} onClose={closeCreate} /> : null}
    </View>
  );
}

function KeyRow({
  sshKey,
  onDelete,
}: {
  sshKey: SshKeyInfo;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => void onDelete(sshKey.id), [onDelete, sshKey.id]);
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <ThemedKey size={16} uniProps={keyIconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sshKey.label}
        </Text>
        <Text style={styles.rowSubtitle}>{sshKey.keyType ?? t("ssh.keychain.typeUnknown")}</Text>
      </View>
      <Pressable
        onPress={handleDelete}
        accessibilityRole="button"
        hitSlop={8}
        testID={`ssh-key-delete-${sshKey.id}`}
      >
        <ThemedTrash size={16} uniProps={mutedIconColor} />
      </Pressable>
    </View>
  );
}

function NewKeySheet({ serverId, onClose }: { serverId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const controlSize = useIsCompactFormFactor() ? "md" : "sm";
  const { createKey, isSaving } = useSshKeys(serverId);
  const [label, setLabel] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const header = useMemo<SheetHeader>(() => ({ title: t("ssh.keychain.newKey") }), [t]);
  const canSubmit = privateKey.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    await createKey({
      label: label.trim() || "key",
      privateKey,
      ...(publicKey.trim() ? { publicKey } : {}),
      ...(passphrase ? { passphrase } : {}),
    });
    onClose();
  }, [canSubmit, createKey, label, privateKey, publicKey, passphrase, onClose]);
  const handleSubmitPress = useCallback(() => void handleSubmit(), [handleSubmit]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" style={styles.footerButton} onPress={onClose}>
          {t("ssh.form.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={isSaving}
          testID="ssh-key-submit"
        >
          {t("ssh.form.save")}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, isSaving, onClose, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      webScrollbar
      testID="ssh-key-sheet"
    >
      <View style={styles.form}>
        <Field label={t("ssh.keychain.label")}>
          <FormTextInput
            size={controlSize}
            initialValue={label}
            value={label}
            onChangeText={setLabel}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label={t("ssh.keychain.privateKey")}>
          <FormTextInput
            size={controlSize}
            initialValue={privateKey}
            value={privateKey}
            onChangeText={setPrivateKey}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            style={styles.multiline}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label={t("ssh.keychain.publicKey")}>
          <FormTextInput
            size={controlSize}
            initialValue={publicKey}
            value={publicKey}
            onChangeText={setPublicKey}
            style={styles.multiline}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <Field label={t("ssh.keychain.passphrase")}>
          <FormTextInput
            size={controlSize}
            initialValue={passphrase}
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
      </View>
    </AdaptiveModalSheet>
  );
}

const ThemedKey = withUnistyles(KeyRound);
const ThemedTrash = withUnistyles(Trash2);
const keyIconColor = (theme: Theme) => ({ color: theme.colors.accent });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme: Theme) => ({
  section: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    padding: theme.spacing[3],
  },
  list: {
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.sm,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  form: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  multiline: {
    minHeight: 96,
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
