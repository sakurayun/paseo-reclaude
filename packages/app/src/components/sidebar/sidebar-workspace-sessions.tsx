import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
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
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";
import { navigateToAgentDirectoryEntry } from "@/utils/navigate-to-agent-directory-entry";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";

const MAX_SIDEBAR_SESSIONS = 5;
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
  const { agents } = useAgentHistory({ serverId: input.serverId });
  const liveAgentsMap = useSessionStore((state) => state.sessions[input.serverId]?.agents);
  const workspacesMap = useSessionStore((state) => state.sessions[input.serverId]?.workspaces);
  const workspaces = useMemo(
    () => (workspacesMap ? Array.from(workspacesMap.values()) : EMPTY_WORKSPACES),
    [workspacesMap],
  );

  const mergedAgents = useMemo(() => {
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

function SidebarSessionRow({ session }: { session: AgentDirectoryEntry }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { archiveAgent } = useArchiveAgent();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const handlePress = useCallback(() => {
    navigateToAgentDirectoryEntry(session);
  }, [session]);

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

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sessionRow,
      (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [],
  );
  const ProviderIcon = useMemo(
    () => withUnistyles(getProviderIcon(session.provider), mutedColorMapping),
    [session.provider],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        onPress={handlePress}
        style={pressableStyle}
        accessibilityRole="button"
        testID={`sidebar-session-${session.id}`}
      >
        <View style={styles.sessionIcon}>
          <ProviderIcon size={12} />
        </View>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {session.title ?? t("sessions.workspacePanel.untitled")}
        </Text>
        <Text style={styles.sessionTime} numberOfLines={1}>
          {formatTimeAgo(session.lastActivityAt)}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={200}
        mobileMode="sheet"
        testID={`sidebar-session-context-${session.id}`}
      >
        <ContextMenuItem
          testID={`sidebar-session-context-${session.id}-rename`}
          onSelect={handleOpenRename}
        >
          {t("sidebar.workspace.sessions.editTitle")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-context-${session.id}-archive`}
          status={isArchiving ? "pending" : "idle"}
          pendingLabel={t("sidebar.workspace.sessions.archivePending")}
          destructive
          onSelect={handleArchive}
        >
          {t("sidebar.workspace.sessions.archive")}
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
}

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
    <View style={styles.container}>
      {sessions.slice(0, MAX_SIDEBAR_SESSIONS).map((session) => (
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
  );
});

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  rowHovered: {
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
  sessionIcon: {
    width: 14,
    alignItems: "center",
    flexShrink: 0,
  },
  sessionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
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
