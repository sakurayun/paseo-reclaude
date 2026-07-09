import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pencil } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { OsBadge } from "@/components/ssh/os-badge";
import type { Theme } from "@/styles/theme";

interface SshHostsSectionProps {
  hosts: SshHostInfo[];
  isLoading: boolean;
  connectingHostId: string | null;
  onConnect: (hostId: string) => void;
  onEdit: (hostId: string) => void;
}

// Main-panel host grid: tap a card to connect, tap the pencil to edit. Mirrors
// the open-project tile grid (wrap on desktop, single column on compact).
export function SshHostsSection({
  hosts,
  isLoading,
  connectingHostId,
  onConnect,
  onEdit,
}: SshHostsSectionProps) {
  const { t } = useTranslation();

  if (!isLoading && hosts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t("ssh.hosts.empty")}</Text>
        <Text style={styles.emptyDescription}>{t("ssh.hosts.emptyDescription")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {hosts.map((host) => (
        <SshHostCard
          key={host.id}
          host={host}
          isConnecting={connectingHostId === host.id}
          onConnect={onConnect}
          onEdit={onEdit}
        />
      ))}
    </View>
  );
}

function SshHostCard({
  host,
  isConnecting,
  onConnect,
  onEdit,
}: {
  host: SshHostInfo;
  isConnecting: boolean;
  onConnect: (hostId: string) => void;
  onEdit: (hostId: string) => void;
}) {
  const { t } = useTranslation();
  const subtitle = host.username ? `${host.username}@${host.address}` : host.address;
  const handleConnect = useCallback(() => onConnect(host.id), [onConnect, host.id]);
  const handleEdit = useCallback(() => onEdit(host.id), [onEdit, host.id]);

  // The connect target and the edit button are siblings inside a plain-View
  // card — nesting the edit <button> inside the card <button> is invalid HTML
  // and breaks web hydration.
  const connectStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.connectArea,
      Boolean(hovered) && styles.connectAreaHovered,
      pressed && styles.cardPressed,
    ],
    [],
  );
  const editStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.editButton,
      (Boolean(hovered) || pressed) && styles.editButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.card}>
      <Pressable
        style={connectStyle}
        onPress={handleConnect}
        disabled={isConnecting}
        accessibilityRole="button"
        accessibilityLabel={host.label || host.address}
        testID={`ssh-host-card-${host.id}`}
      >
        <OsBadge os={host.platform?.os ?? null} size={40} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {host.label || host.address}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {isConnecting ? t("ssh.hosts.connecting") : subtitle}
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={editStyle}
        onPress={handleEdit}
        accessibilityRole="button"
        accessibilityLabel={t("ssh.hosts.edit")}
        testID={`ssh-host-edit-${host.id}`}
        hitSlop={8}
      >
        <ThemedPencil size={16} uniProps={mutedIconColor} />
      </Pressable>
    </View>
  );
}

const ThemedPencil = withUnistyles(Pencil);
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme: Theme) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  card: {
    width: { xs: "100%", md: 280 },
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.xl,
    overflow: "hidden",
    ...theme.shadow.sm,
  },
  // The connect target fills the card beside the trailing edit button; its
  // hover highlight stands in for the whole-card hover.
  connectArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  connectAreaHovered: {
    backgroundColor: theme.colors.surface2,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  cardSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  editButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[8],
    gap: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
