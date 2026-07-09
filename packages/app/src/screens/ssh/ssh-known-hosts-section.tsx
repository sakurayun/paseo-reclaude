import { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Fingerprint, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSshKnownHosts } from "@/screens/ssh/use-ssh-known-hosts";
import type { SshKnownHostInfo } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

interface SshKnownHostsSectionProps {
  serverId: string | null;
}

export function SshKnownHostsSection({ serverId }: SshKnownHostsSectionProps) {
  const { t } = useTranslation();
  const { knownHosts, deleteKnownHost, importKnownHosts, isSaving } = useSshKnownHosts(serverId);
  const handleImport = useCallback(() => void importKnownHosts(), [importKnownHosts]);

  return (
    <View style={styles.section}>
      <View style={styles.toolbar}>
        <Button
          variant="secondary"
          onPress={handleImport}
          loading={isSaving}
          testID="ssh-import-known-hosts"
        >
          {t("ssh.knownHosts.import")}
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {knownHosts.length === 0 ? (
          <Text style={styles.empty}>{t("ssh.knownHosts.empty")}</Text>
        ) : (
          knownHosts.map((entry) => (
            <KnownHostRow key={entry.id} entry={entry} onDelete={deleteKnownHost} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function KnownHostRow({
  entry,
  onDelete,
}: {
  entry: SshKnownHostInfo;
  onDelete: (id: string) => Promise<void>;
}) {
  const handleDelete = useCallback(() => void onDelete(entry.id), [onDelete, entry.id]);
  const hostLabel = entry.port ? `${entry.host}:${entry.port}` : entry.host;
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <ThemedFingerprint size={16} uniProps={iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {hostLabel}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {entry.keyType} · {entry.fingerprintSha256}
        </Text>
      </View>
      <Pressable
        onPress={handleDelete}
        accessibilityRole="button"
        hitSlop={8}
        testID={`ssh-known-host-delete-${entry.id}`}
      >
        <ThemedTrash size={16} uniProps={mutedIconColor} />
      </Pressable>
    </View>
  );
}

const ThemedFingerprint = withUnistyles(Fingerprint);
const ThemedTrash = withUnistyles(Trash2);
const iconColor = (theme: Theme) => ({ color: theme.colors.accent });
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
}));
