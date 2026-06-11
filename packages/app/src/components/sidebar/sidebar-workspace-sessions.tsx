import { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { getProviderBrandColor, getProviderIcon } from "@/components/provider-icons";
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

  const stateBucket = deriveSidebarStateBucket({
    status: session.status,
    pendingPermissionCount: session.pendingPermissionCount ?? 0,
    requiresAttention: session.requiresAttention,
    attentionReason: session.attentionReason,
  });

  const ProviderIcon = useMemo(() => {
    let colorMapping = mutedColorMapping;
    if (stateBucket === "failed") {
      colorMapping = failedColorMapping;
    } else if (stateBucket === "needs_input") {
      colorMapping = needsInputColorMapping;
    }
    return withUnistyles(getProviderIcon(session.provider), colorMapping);
  }, [session.provider, stateBucket]);

  const titleStyle = useMemo(
    () => [
      styles.sessionTitle,
      stateBucket === "failed" && styles.sessionTitleFailed,
      stateBucket === "needs_input" && styles.sessionTitleNeedsInput,
    ],
    [stateBucket],
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
          {stateBucket === "running" ? (
            <SessionRunningIconOverlay provider={session.provider} />
          ) : null}
          {stateBucket === "attention" ? <View style={styles.attentionDot} /> : null}
        </View>
        <Text style={titleStyle} numberOfLines={1}>
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

/**
 * Breathing colored copy of the provider icon, stacked over the gray base
 * icon while the agent is running. Opacity pulses 0 → 1 so the icon fades
 * between gray and the provider's brand color (theme accent as fallback).
 */
function SessionRunningIconOverlay({ provider }: { provider: string }) {
  const breath = useSharedValue(0);

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(breath);
    };
  }, [breath]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: breath.value }));
  const containerStyle = useMemo(() => [styles.iconOverlay, overlayStyle], [overlayStyle]);

  const OverlayIcon = useMemo((): ComponentType<{ size: number }> => {
    const Icon = getProviderIcon(provider);
    const brandColor = getProviderBrandColor(provider);
    if (brandColor) {
      const BrandedIcon = ({ size }: { size: number }) => <Icon size={size} color={brandColor} />;
      BrandedIcon.displayName = `BrandedProviderIcon(${provider})`;
      return BrandedIcon;
    }
    return withUnistyles(Icon, accentColorMapping) as unknown as ComponentType<{ size: number }>;
  }, [provider]);

  return (
    <Animated.View style={containerStyle} pointerEvents="none">
      <OverlayIcon size={12} />
    </Animated.View>
  );
}

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});

const failedColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
});

const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
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
    justifyContent: "center",
    flexShrink: 0,
  },
  iconOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  attentionDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.palette.green[500],
  },
  sessionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
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
