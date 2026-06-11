import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { buildWorkspaceSessionSections } from "@/panels/sessions-panel-model";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";

const MAX_SIDEBAR_SESSIONS = 5;
const EMPTY_WORKSPACES: WorkspaceDescriptor[] = [];
const EMPTY_SESSIONS: AgentDirectoryEntry[] = [];

/**
 * Recent non-archived sessions attributed to one workspace. Every row shares
 * the per-server react-query history cache, so this does not fan out requests.
 */
export function useWorkspaceSessions(input: {
  serverId: string;
  workspaceId: string;
}): AgentDirectoryEntry[] {
  const { agents } = useAgentHistory({ serverId: input.serverId });
  const workspacesMap = useSessionStore((state) => state.sessions[input.serverId]?.workspaces);
  const workspaces = useMemo(
    () => (workspacesMap ? Array.from(workspacesMap.values()) : EMPTY_WORKSPACES),
    [workspacesMap],
  );

  return useMemo(() => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: input.workspaceId,
      workspaces,
      agents,
      includeArchived: false,
      otherSectionTitle: "",
    });
    return (
      sections.find((section) => section.workspaceId === input.workspaceId)?.sessions ??
      EMPTY_SESSIONS
    );
  }, [agents, input.workspaceId, workspaces]);
}

function SidebarSessionRow({
  session,
  serverId,
  workspaceId,
}: {
  session: AgentDirectoryEntry;
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target: { kind: "agent", agentId: session.id },
    });
  }, [serverId, session.id, workspaceId]);
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
    <Pressable
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
    </Pressable>
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
        <SidebarSessionRow
          key={session.id}
          session={session}
          serverId={serverId}
          workspaceId={workspaceId}
        />
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
