import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, History, SquareTerminal } from "lucide-react-native";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type { TerminalHistoryEntry } from "@getpaseo/protocol/messages";
import { useHostFeature } from "@/runtime/host-features";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import invariant from "tiny-invariant";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getProviderIcon } from "@/components/provider-icons";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import {
  buildWorkspaceSessionSections,
  type WorkspaceSessionSection,
} from "@/panels/sessions-panel-model";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { navigateToAgentDirectoryEntry } from "@/utils/navigate-to-agent-directory-entry";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";

const EMPTY_WORKSPACES: WorkspaceDescriptor[] = [];

function useSessionsPanelDescriptor(
  _target: { kind: "sessions"; workspaceId: string },
  _context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("sessions.title"),
    subtitle: t("sessions.workspacePanel.tabSubtitle"),
    titleState: "ready",
    icon: History,
    statusBucket: null,
  };
}

function SessionRow({
  session,
  onOpen,
}: {
  session: AgentDirectoryEntry;
  onOpen: (session: AgentDirectoryEntry) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(session), [onOpen, session]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sessionRow,
      (Boolean(hovered) || pressed) && styles.sessionRowHovered,
    ],
    [],
  );
  const ProviderIcon = useMemo(
    () => withUnistyles(getProviderIcon(session.provider), providerIconMapping),
    [session.provider],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      testID={`sessions-panel-row-${session.id}`}
    >
      <View style={styles.sessionIcon}>
        <ProviderIcon size={16} />
      </View>
      <View style={styles.sessionBody}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {session.title ?? t("sessions.workspacePanel.untitled")}
        </Text>
        <Text style={styles.sessionMeta} numberOfLines={1}>
          {formatTimeAgo(session.lastActivityAt)}
        </Text>
      </View>
      {session.archivedAt ? (
        <View style={styles.archivedBadge}>
          <Text style={styles.archivedBadgeText}>{t("agentList.badges.archived")}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ClosedTerminalRow({
  entry,
  onRestore,
  restoring,
}: {
  entry: TerminalHistoryEntry;
  onRestore: (entry: TerminalHistoryEntry) => void;
  restoring: boolean;
}) {
  const { t } = useTranslation();
  const handleRestore = useCallback(() => onRestore(entry), [entry, onRestore]);
  const failed = entry.exitCode != null && entry.exitCode !== 0;

  return (
    <View style={styles.sessionRow} testID={`sessions-panel-terminal-${entry.id}`}>
      <View style={styles.sessionIcon}>
        <ThemedSquareTerminal size={16} uniProps={mutedColorMapping} />
      </View>
      <View style={styles.sessionBody}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {entry.title?.trim() || entry.name}
        </Text>
        <Text style={styles.sessionMeta} numberOfLines={1}>
          {formatTimeAgo(new Date(entry.closedAt))}
          {failed ? ` · exit ${entry.exitCode}` : ""}
        </Text>
      </View>
      <Pressable
        onPress={handleRestore}
        disabled={restoring}
        style={styles.archivedToggle}
        accessibilityRole="button"
        testID={`sessions-panel-terminal-${entry.id}-restore`}
      >
        <Text style={styles.archivedToggleText}>
          {t("sessions.workspacePanel.restoreTerminal")}
        </Text>
      </Pressable>
    </View>
  );
}

function SectionHeader({ section }: { section: WorkspaceSessionSection }) {
  const { t } = useTranslation();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {section.title}
      </Text>
      {section.branch ? (
        <View style={styles.branchChip}>
          <ThemedGitBranch size={11} uniProps={mutedColorMapping} />
          <Text style={styles.branchChipText} numberOfLines={1}>
            {section.branch}
          </Text>
        </View>
      ) : null}
      {section.isCurrent ? (
        <Text style={styles.currentBadge}>{t("sessions.workspacePanel.currentBadge")}</Text>
      ) : null}
      <View style={styles.sectionSpacer} />
      <Text style={styles.sectionCount}>{section.sessions.length}</Text>
    </View>
  );
}

function SessionsPanel() {
  const { t } = useTranslation();
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "sessions", "SessionsPanel requires sessions target");

  const [includeArchived, setIncludeArchived] = useState(false);
  const { agents, isInitialLoad } = useAgentHistory({ serverId });
  const workspacesMap = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const workspaces = useMemo(
    () => (workspacesMap ? Array.from(workspacesMap.values()) : EMPTY_WORKSPACES),
    [workspacesMap],
  );

  const sections = useMemo(
    () =>
      buildWorkspaceSessionSections({
        currentWorkspaceId: target.workspaceId,
        workspaces,
        agents,
        includeArchived,
        otherSectionTitle: t("sessions.workspacePanel.otherSection"),
      }),
    [agents, includeArchived, t, target.workspaceId, workspaces],
  );

  const handleOpenSession = useCallback((session: AgentDirectoryEntry) => {
    navigateToAgentDirectoryEntry(session);
  }, []);

  // Closed-terminal history (kill from the tab close prompt). Only listed when
  // archived sessions are shown — same "history" gesture — and only on daemons
  // with the terminalLifecycle capability.
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const queryClient = useQueryClient();
  const supportsTerminalLifecycle = useHostFeature(serverId, "terminalLifecycle");
  const terminalHistoryEnabled = includeArchived && supportsTerminalLifecycle && Boolean(client);
  const terminalHistoryQuery = useFetchQuery({
    queryKey: ["terminal-history", serverId],
    enabled: terminalHistoryEnabled,
    dataShape: "list",
    staleTimeMs: 10_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return await client.listTerminalHistory();
    },
  });
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === target.workspaceId) ?? null,
    [target.workspaceId, workspaces],
  );
  const closedTerminals = useMemo(() => {
    if (!terminalHistoryEnabled) {
      return [];
    }
    const root = currentWorkspace?.projectRootPath ?? currentWorkspace?.workspaceDirectory ?? null;
    const entries = terminalHistoryQuery.data?.entries ?? [];
    if (!root) {
      return entries;
    }
    return entries.filter((entry) => entry.cwd === root || entry.cwd.startsWith(`${root}/`));
  }, [currentWorkspace, terminalHistoryEnabled, terminalHistoryQuery.data]);

  const [restoringTerminalId, setRestoringTerminalId] = useState<string | null>(null);
  const handleRestoreTerminal = useCallback(
    (entry: TerminalHistoryEntry) => {
      if (!client || restoringTerminalId) {
        return;
      }
      setRestoringTerminalId(entry.id);
      void (async () => {
        try {
          const payload = await client.createTerminal(entry.cwd, entry.name, undefined, {
            workspaceId: target.workspaceId,
          });
          const created = payload.terminal;
          if (created) {
            navigateToPreparedWorkspaceTab({
              serverId,
              workspaceId: target.workspaceId,
              target: { kind: "terminal", terminalId: created.id },
            });
          }
        } catch (error) {
          console.warn("[sessions-panel] failed to restore terminal", error);
        } finally {
          setRestoringTerminalId(null);
          void queryClient.invalidateQueries({ queryKey: ["terminal-history", serverId] });
        }
      })();
    },
    [client, queryClient, restoringTerminalId, serverId, target.workspaceId],
  );

  const handleToggleArchived = useCallback(() => {
    setIncludeArchived((current) => !current);
  }, []);

  const toggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.archivedToggle,
      (Boolean(hovered) || pressed) && styles.archivedToggleHovered,
    ],
    [],
  );

  const hasAnySession =
    sections.some((section) => section.sessions.length > 0) || closedTerminals.length > 0;

  return (
    <View style={styles.container} testID="workspace-sessions-panel">
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>{t("sessions.title")}</Text>
        <Pressable
          onPress={handleToggleArchived}
          style={toggleStyle}
          accessibilityRole="switch"
          accessibilityState={useMemo(() => ({ checked: includeArchived }), [includeArchived])}
          testID="sessions-panel-toggle-archived"
        >
          <Text
            style={includeArchived ? styles.archivedToggleTextActive : styles.archivedToggleText}
          >
            {t("sessions.workspacePanel.includeArchived")}
          </Text>
        </Pressable>
      </View>

      {isInitialLoad ? (
        <View style={styles.centerState}>
          <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
        </View>
      ) : null}

      {!isInitialLoad && !hasAnySession ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>{t("sessions.workspacePanel.empty")}</Text>
        </View>
      ) : null}

      {!isInitialLoad && hasAnySession ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {sections.map((section) =>
            section.sessions.length > 0 ? (
              <View key={section.workspaceId ?? "__other__"} style={styles.section}>
                <SectionHeader section={section} />
                <View style={styles.sectionBody}>
                  {section.sessions.map((session) => (
                    <SessionRow key={session.id} session={session} onOpen={handleOpenSession} />
                  ))}
                </View>
              </View>
            ) : null,
          )}
          {closedTerminals.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {t("sessions.workspacePanel.closedTerminals")}
                </Text>
                <View style={styles.sectionSpacer} />
                <Text style={styles.sectionCount}>{closedTerminals.length}</Text>
              </View>
              <View style={styles.sectionBody}>
                {closedTerminals.map((entry) => (
                  <ClosedTerminalRow
                    key={`${entry.id}:${entry.closedAt}`}
                    entry={entry}
                    onRestore={handleRestoreTerminal}
                    restoring={restoringTerminalId === entry.id}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

export const sessionsPanelRegistration: PanelRegistration<"sessions"> = {
  kind: "sessions",
  component: SessionsPanel,
  useDescriptor: useSessionsPanelDescriptor,
};

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const providerIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  toolbarTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  archivedToggle: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  archivedToggleHovered: {
    backgroundColor: theme.colors.surface2,
  },
  archivedToggleText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  archivedToggleTextActive: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  section: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  branchChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    flexShrink: 1,
    minWidth: 0,
  },
  branchChipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  currentBadge: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.medium,
  },
  sectionSpacer: {
    flex: 1,
  },
  sectionCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  sectionBody: {},
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  sessionRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  sessionIcon: {
    width: 20,
    alignItems: "center",
    flexShrink: 0,
  },
  sessionBody: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  sessionMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  archivedBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  archivedBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
