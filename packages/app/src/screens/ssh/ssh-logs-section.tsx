import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useSshLogs } from "@/screens/ssh/use-ssh-logs";
import type { SshLogEntry } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

interface SshLogsSectionProps {
  serverId: string | null;
}

export function SshLogsSection({ serverId }: SshLogsSectionProps) {
  const { t } = useTranslation();
  const { entries } = useSshLogs(serverId);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.col}>
          <Text style={styles.headerCell}>{t("ssh.logs.date")}</Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.headerCell}>{t("ssh.logs.user")}</Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.headerCell}>{t("ssh.logs.host")}</Text>
        </View>
        <View style={styles.col}>
          <Text style={styles.headerCell}>{t("ssh.logs.duration")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>{t("ssh.logs.empty")}</Text>
        ) : (
          entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </View>
  );
}

function LogRow({ entry }: { entry: SshLogEntry }) {
  const { t } = useTranslation();
  const dateLabel = useMemo(() => new Date(entry.startedAt).toLocaleString(), [entry.startedAt]);
  const duration = useMemo(() => formatDuration(entry.durationMs ?? null), [entry.durationMs]);
  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <Text style={styles.cell} numberOfLines={1}>
          {dateLabel}
        </Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.cell} numberOfLines={1}>
          {entry.username ?? "—"}
        </Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.cell} numberOfLines={1}>
          {entry.hostLabel}
        </Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.cell} numberOfLines={1}>
          {duration} · {statusLabel(entry.status, t)}
        </Text>
      </View>
    </View>
  );
}

function statusLabel(status: SshLogEntry["status"], t: (key: string) => string): string {
  switch (status) {
    case "connected":
      return t("ssh.logs.statusConnected");
    case "closed":
      return t("ssh.logs.statusClosed");
    default:
      return t("ssh.logs.statusFailed");
  }
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) {
    return "—";
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const styles = StyleSheet.create((theme: Theme) => ({
  section: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.shell.chromeDivider,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
  },
  list: {
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
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.shell.chromeDivider,
    borderBottomColor: theme.colors.border,
  },
  cell: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  col: {
    flex: 2,
  },
}));
