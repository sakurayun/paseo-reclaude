import { useCallback, useMemo } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter, usePathname } from "expo-router";
import {
  Fingerprint,
  KeyRound,
  Network,
  ScrollText,
  Server,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { OsBadge } from "@/components/ssh/os-badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useConnectSshHost } from "@/screens/ssh/use-connect-ssh-host";
import { buildSshRoute, type SshSection } from "@/screens/ssh/ssh-navigation";
import { useHostTerminals } from "@/hooks/use-host-terminals";
import { useSshTerminalMetaStore } from "@/stores/ssh-terminal-meta-store";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import type { Theme } from "@/styles/theme";

interface SidebarSshListProps {
  serverId: string | null;
  onNavigate?: () => void;
}

interface SectionEntry {
  section: SshSection;
  icon: LucideIcon;
  labelKey: string;
}

const SECTION_ENTRIES: readonly SectionEntry[] = [
  { section: "hosts", icon: Server, labelKey: "ssh.sections.hosts" },
  { section: "keychain", icon: KeyRound, labelKey: "ssh.sections.keychain" },
  { section: "forwards", icon: Network, labelKey: "ssh.sections.forwards" },
  { section: "knownhosts", icon: Fingerprint, labelKey: "ssh.sections.knownHosts" },
  { section: "logs", icon: ScrollText, labelKey: "ssh.sections.logs" },
];

// New-theme sidebar body for the SSH manager: five function entries that route
// to the main-panel sections, then the saved-host list (tap = connect).
export function SidebarSshList({ serverId, onNavigate }: SidebarSshListProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { hosts } = useSshHosts(serverId);
  const { connectHost } = useConnectSshHost(serverId);
  const { terminals } = useHostTerminals(serverId);
  const metaByTerminalId = useSshTerminalMetaStore((state) => state.metaByTerminalId);
  const toast = useToast();

  const activeSection = useMemo<SshSection | null>(() => {
    if (!pathname.startsWith("/ssh")) {
      return null;
    }
    // pathname doesn't carry query params in expo-router; the active highlight
    // is best-effort — "hosts" is the default landing section.
    return "hosts";
  }, [pathname]);

  const openSection = useCallback(
    (section: SshSection) => {
      router.push(buildSshRoute(section));
      onNavigate?.();
    },
    [router, onNavigate],
  );

  // Tapping a host opens a connecting tab (which navigates to its workspace) —
  // no detour through the /ssh page.
  const handleConnect = useCallback(
    (hostId: string) => {
      connectHost(hostId);
      onNavigate?.();
    },
    [connectHost, onNavigate],
  );
  // Right-click "new tab & connect": always start a fresh connect/tab.
  const handleNewTabConnect = useCallback(
    (hostId: string) => {
      connectHost(hostId, { force: true });
      onNavigate?.();
    },
    [connectHost, onNavigate],
  );
  // Right-click "close all SSH shells": kill every live SSH terminal on this
  // daemon (across hosts and workspaces), after a destructive confirmation.
  const handleCloseAllShells = useCallback(async () => {
    const sshTerminals = terminals.filter(
      (terminal) => metaByTerminalId[terminal.id] && terminal.status !== "exited",
    );
    if (sshTerminals.length === 0) {
      return;
    }
    const confirmed = await confirmDialog({
      title: t("ssh.hosts.menu.closeAllShellsTitle"),
      message: t("ssh.hosts.menu.closeAllShellsMessage", { count: sshTerminals.length }),
      confirmLabel: t("workspace.tabs.confirmations.close"),
      cancelLabel: t("workspace.tabs.confirmations.cancel"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    const client = serverId
      ? (useSessionStore.getState().sessions[serverId]?.client ?? null)
      : null;
    if (!client) {
      return;
    }
    const results = await Promise.allSettled(
      sshTerminals.map((terminal) => client.killTerminal(terminal.id)),
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      const reason = (failed[0] as PromiseRejectedResult).reason;
      toast.error(toErrorMessage(reason));
    }
  }, [metaByTerminalId, serverId, t, terminals, toast]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.sectionGroup}>
        {SECTION_ENTRIES.map((entry) => (
          <SshSectionRow
            key={entry.section}
            entry={entry}
            label={t(entry.labelKey)}
            isActive={entry.section === "hosts" && activeSection === "hosts"}
            onSelect={openSection}
          />
        ))}
      </View>

      <View style={styles.hostList}>
        <Text style={styles.hostListHeader}>{t("ssh.sections.hosts")}</Text>
        {hosts.length === 0 ? (
          <Text style={styles.emptyLabel}>{t("ssh.hosts.empty")}</Text>
        ) : (
          hosts.map((host) => (
            <SshHostRow
              key={host.id}
              hostId={host.id}
              label={host.label || host.address}
              subtitle={host.username ? `${host.username}@${host.address}` : host.address}
              os={host.platform?.os ?? null}
              onConnect={handleConnect}
              onNewTabConnect={handleNewTabConnect}
              onCloseAllShells={handleCloseAllShells}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function SshSectionRow({
  entry,
  label,
  isActive,
  onSelect,
}: {
  entry: SectionEntry;
  label: string;
  isActive: boolean;
  onSelect: (section: SshSection) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry.section), [onSelect, entry.section]);
  return (
    <SidebarHeaderRow
      icon={entry.icon}
      label={label}
      onPress={handlePress}
      isActive={isActive}
      testID={`sidebar-ssh-${entry.section}`}
      variant="compact"
    />
  );
}

function SshHostRow({
  hostId,
  label,
  subtitle,
  os,
  onConnect,
  onNewTabConnect,
  onCloseAllShells,
}: {
  hostId: string;
  label: string;
  subtitle: string;
  os: string | null;
  onConnect: (hostId: string) => void;
  onNewTabConnect: (hostId: string) => void;
  onCloseAllShells: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onConnect(hostId), [onConnect, hostId]);
  const handleNewTab = useCallback(() => onNewTabConnect(hostId), [onNewTabConnect, hostId]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.hostRow,
      (Boolean(hovered) || pressed) && styles.hostRowHovered,
    ],
    [],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={rowStyle}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={`sidebar-ssh-host-${hostId}`}
      >
        <OsBadge os={os} size={28} />
        <View style={styles.hostText}>
          <Text style={styles.hostLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.hostSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={220}
        mobileMode="sheet"
        testID={`sidebar-ssh-host-context-${hostId}`}
      >
        <ContextMenuItem
          testID={`sidebar-ssh-host-context-${hostId}-new-tab`}
          onSelect={handleNewTab}
        >
          {t("ssh.hosts.menu.newTabConnect")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-ssh-host-context-${hostId}-close-all`}
          destructive
          onSelect={onCloseAllShells}
        >
          {t("ssh.hosts.menu.closeAllShells")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: theme.spacing[3],
  },
  sectionGroup: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    gap: theme.spacing[1] / 2,
  },
  hostList: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[1] / 2,
  },
  hostListHeader: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  emptyLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.shell.contentRadius,
  },
  hostRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  hostText: {
    flex: 1,
    minWidth: 0,
  },
  hostLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  hostSubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
