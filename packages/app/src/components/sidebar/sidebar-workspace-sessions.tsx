import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import { SessionStatusIcon } from "@/components/sidebar/session-status-icon";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { buildWorkspaceSessionSections } from "@/panels/sessions-panel-model";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";
import { navigateToAgentDirectoryEntry } from "@/utils/navigate-to-agent-directory-entry";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import {
  SidebarSessionSelectionProvider,
  useSidebarSessionSelection,
} from "@/components/sidebar/sidebar-session-selection-context";
import { toSidebarSessionSelectionKey } from "@/components/sidebar/sidebar-session-selection";

const MAX_SIDEBAR_SESSIONS = 5;
// The new-theme flat sessions list is primary navigation, so its rows get a
// larger leading provider icon than the nested per-workspace session rows.
const FLAT_SESSION_ICON_SIZE = 16;
const EMPTY_WORKSPACES: WorkspaceDescriptor[] = [];
const EMPTY_SESSIONS: AgentDirectoryEntry[] = [];

/**
 * Recent non-archived sessions attributed to one workspace. Every row shares
 * the per-server react-query history cache, so this does not fan out requests.
 * Live agents from the session store are overlaid on the cached history so
 * new sessions, renames, and archives show up without a refetch.
 */
export function useWorkspaceSessions(input: {
  serverId: string;
  workspaceId: string;
}): AgentDirectoryEntry[] {
  const mergedAgents = useMergedAgentHistory(input.serverId);
  const workspacesMap = useSessionStore((state) => state.sessions[input.serverId]?.workspaces);
  const workspaces = useMemo(
    () => (workspacesMap ? Array.from(workspacesMap.values()) : EMPTY_WORKSPACES),
    [workspacesMap],
  );

  return useMemo(() => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: input.workspaceId,
      workspaces,
      agents: mergedAgents,
      includeArchived: false,
      otherSectionTitle: "",
    });
    return (
      sections.find((section) => section.workspaceId === input.workspaceId)?.sessions ??
      EMPTY_SESSIONS
    );
  }, [mergedAgents, input.workspaceId, workspaces]);
}

/**
 * Recent non-archived sessions whose cwd falls under the project root. Used by
 * the workspace group mode for projects without branch (worktree) rows, where
 * no per-branch row exists to host the session list.
 */
export function useProjectSessions(input: {
  serverId: string;
  projectRootPath: string | null;
}): AgentDirectoryEntry[] {
  const mergedAgents = useMergedAgentHistory(input.serverId);

  return useMemo(() => {
    const root = input.projectRootPath;
    if (!root) {
      return EMPTY_SESSIONS;
    }
    return mergedAgents
      .filter(
        (agent) =>
          agent.archivedAt == null && (agent.cwd === root || agent.cwd.startsWith(`${root}/`)),
      )
      .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
  }, [mergedAgents, input.projectRootPath]);
}

function useMergedAgentHistory(serverId: string): AgentDirectoryEntry[] {
  const { agents } = useAgentHistory({ serverId });
  const liveAgentsMap = useSessionStore((state) => state.sessions[serverId]?.agents);

  return useMemo(() => {
    if (!liveAgentsMap || liveAgentsMap.size === 0) {
      return agents;
    }
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const agent of liveAgentsMap.values()) {
      byId.set(agent.id, {
        id: agent.id,
        serverId: agent.serverId,
        serverLabel: agent.serverId,
        title: agent.title ?? null,
        status: agent.status,
        lastActivityAt: agent.lastActivityAt,
        cwd: agent.cwd,
        provider: agent.provider,
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
        attentionTimestamp: agent.attentionTimestamp ?? null,
        archivedAt: agent.archivedAt ?? null,
        createdAt: agent.createdAt,
        labels: agent.labels,
      });
    }
    return Array.from(byId.values());
  }, [agents, liveAgentsMap]);
}

export const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  subtitle = null,
  timeOverride = null,
  variant = "default",
}: {
  session: AgentDirectoryEntry;
  /** Secondary line under the title — the flat sessions list shows the project. */
  subtitle?: string | null;
  /** Time to display + the caller already sorted by (e.g. last user message). */
  timeOverride?: Date | null;
  /**
   * "flat" rounds the hover/press background to the content-card radius so the
   * new-theme flat sessions list reads as part of the same rounded surface as
   * the right pane. "default" keeps the tighter nested-row radius.
   */
  variant?: "default" | "flat";
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { archiveAgent } = useArchiveAgent();
  const selection = useSidebarSessionSelection();
  const selectionKey = useMemo(
    () => toSidebarSessionSelectionKey({ serverId: session.serverId, id: session.id }),
    [session.id, session.serverId],
  );
  const isRowSelected = selection?.isSelected(selectionKey) ?? false;
  const isBulkContext =
    Boolean(selection) && selection!.selectedCount > 1 && selection!.isSelected(selectionKey);
  const accessibilityState = useMemo(() => ({ selected: isRowSelected }), [isRowSelected]);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const handlePress = useCallback(
    (event?: unknown) => {
      if (selection?.handleRowPress({ key: selectionKey, event })) {
        return;
      }
      navigateToAgentDirectoryEntry(session);
    },
    [selection, selectionKey, session],
  );

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        selection?.prepareContextMenu(selectionKey);
      }
    },
    [selection, selectionKey],
  );

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);
  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);
  const handleRenameSubmit = useCallback(
    async (nextTitle: string) => {
      const client = useSessionStore.getState().sessions[session.serverId]?.client ?? null;
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      await client.updateAgent(session.id, { name: nextTitle.trim() });
      void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(session.serverId) });
    },
    [queryClient, session.id, session.serverId, t],
  );

  const handleArchive = useCallback(() => {
    if (isArchiving) {
      return;
    }
    setIsArchiving(true);
    void archiveAgent({ serverId: session.serverId, agentId: session.id })
      .catch((error) => {
        toast.error(toErrorMessage(error));
      })
      .finally(() => {
        setIsArchiving(false);
      });
  }, [archiveAgent, isArchiving, session.id, session.serverId, toast]);

  const handleBulkArchive = useCallback(() => {
    if (!selection || isArchiving) {
      return;
    }
    const targets = selection.getSelectedTargets();
    if (targets.length === 0) {
      return;
    }
    selection.clearSelection();
    setIsArchiving(true);
    void (async () => {
      try {
        for (const target of targets) {
          try {
            await archiveAgent({ serverId: target.serverId, agentId: target.agentId });
          } catch (error) {
            toast.error(toErrorMessage(error));
          }
        }
      } finally {
        setIsArchiving(false);
      }
    })();
  }, [archiveAgent, isArchiving, selection, toast]);

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sessionRow,
      variant === "flat" && styles.sessionRowFlatRadius,
      isRowSelected && styles.sessionRowSelected,
      (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [isRowSelected, variant],
  );

  const stateBucket = deriveSidebarStateBucket({
    status: session.status,
    pendingPermissionCount: session.pendingPermissionCount ?? 0,
    requiresAttention: session.requiresAttention,
    attentionReason: session.attentionReason,
  });

  const titleStyle = useMemo(
    () => [
      styles.sessionTitle,
      stateBucket === "failed" && styles.sessionTitleFailed,
      stateBucket === "needs_input" && styles.sessionTitleNeedsInput,
    ],
    [stateBucket],
  );

  const archiveLabel = isBulkContext
    ? t("sidebar.workspace.sessions.archiveSelected", { count: selection!.selectedCount })
    : t("sidebar.workspace.sessions.archive");

  return (
    <ContextMenu onOpenChange={handleMenuOpenChange}>
      <ContextMenuTrigger
        onPress={handlePress}
        style={pressableStyle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        testID={`sidebar-session-${session.id}`}
      >
        <SessionStatusIcon
          provider={session.provider}
          stateBucket={stateBucket}
          size={variant === "flat" ? FLAT_SESSION_ICON_SIZE : undefined}
        />
        <View style={styles.sessionTextColumn}>
          <Text style={titleStyle} numberOfLines={1}>
            {session.title ?? t("sessions.workspacePanel.untitled")}
          </Text>
          {subtitle ? (
            <Text style={styles.sessionSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Text style={styles.sessionTime} numberOfLines={1}>
          {formatTimeAgo(timeOverride ?? session.lastActivityAt)}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={200}
        mobileMode="sheet"
        testID={`sidebar-session-context-${session.id}`}
      >
        {isBulkContext ? null : (
          <ContextMenuItem
            testID={`sidebar-session-context-${session.id}-rename`}
            onSelect={handleOpenRename}
          >
            {t("sidebar.workspace.sessions.editTitle")}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          testID={`sidebar-session-context-${session.id}-archive`}
          status={isArchiving ? "pending" : "idle"}
          pendingLabel={t("sidebar.workspace.sessions.archivePending")}
          destructive
          onSelect={isBulkContext ? handleBulkArchive : handleArchive}
        >
          {archiveLabel}
        </ContextMenuItem>
      </ContextMenuContent>
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={t("sidebar.workspace.sessions.editTitle")}
        initialValue={session.title ?? ""}
        submitLabel={t("workspace.tabs.menu.rename")}
        onClose={handleCloseRename}
        onSubmit={handleRenameSubmit}
        testID={`sidebar-session-rename-${session.id}`}
      />
    </ContextMenu>
  );
});

export const SidebarWorkspaceSessions = memo(function SidebarWorkspaceSessions({
  serverId,
  workspaceId,
  workspaceKey,
  sessions,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  sessions: AgentDirectoryEntry[];
}) {
  const { t } = useTranslation();
  const visibleSessions = useMemo(() => sessions.slice(0, MAX_SIDEBAR_SESSIONS), [sessions]);
  const orderedSessionKeys = useMemo(
    () =>
      visibleSessions.map((session) =>
        toSidebarSessionSelectionKey({ serverId: session.serverId, id: session.id }),
      ),
    [visibleSessions],
  );

  const handleViewAll = useCallback(() => {
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target: { kind: "sessions", workspaceId },
    });
    // Close the compact-layout workspace list overlay so the sessions pane is
    // visible. No-op on desktop.
    usePanelStore.getState().showMobileAgent();
  }, [serverId, workspaceId]);

  const viewAllStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.viewAllRow,
      (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [],
  );

  if (sessions.length === 0) {
    return null;
  }

  return (
    <SidebarSessionSelectionProvider orderedKeys={orderedSessionKeys}>
      <View style={styles.container}>
        {visibleSessions.map((session) => (
          <SidebarSessionRow key={session.id} session={session} />
        ))}
        {sessions.length > MAX_SIDEBAR_SESSIONS ? (
          <Pressable
            onPress={handleViewAll}
            style={viewAllStyle}
            accessibilityRole="button"
            testID={`sidebar-workspace-sessions-view-all-${workspaceKey}`}
          >
            <Text style={styles.viewAllText}>{t("sidebar.workspace.sessions.viewAll")}</Text>
          </Pressable>
        ) : null}
      </View>
    </SidebarSessionSelectionProvider>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sessionRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  // Match the floating content card's corner radius so the new-theme flat list
  // hover/press surface reads as part of the same rounded language as the right pane.
  sessionRowFlatRadius: {
    borderRadius: theme.shell.contentRadius,
  },
  sessionTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  sessionSubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: 1,
  },
  sessionTitleFailed: {
    color: theme.colors.palette.red[500],
  },
  sessionTitleNeedsInput: {
    color: theme.colors.palette.amber[500],
  },
  sessionTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  viewAllRow: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  viewAllText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
  },
}));
