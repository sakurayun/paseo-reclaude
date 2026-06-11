import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, History } from "lucide-react-native";
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

function SidebarSessionRow({
  session,
  serverId,
  workspaceId,
}: {
  session: AgentDirectoryEntry;
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation("workspaces");
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
        {session.title ?? t("sessionsPanel.untitled")}
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
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}) {
  const { t } = useTranslation("workspaces");
  const [expanded, setExpanded] = useState(false);

  // Shared per-server react-query cache with the sessions pane — every
  // workspace row reads the same query, so this does not fan out requests.
  const { agents } = useAgentHistory({ serverId });
  const workspacesMap = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const workspaces = useMemo(
    () => (workspacesMap ? Array.from(workspacesMap.values()) : EMPTY_WORKSPACES),
    [workspacesMap],
  );

  const sessions = useMemo(() => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: workspaceId,
      workspaces,
      agents,
      includeArchived: false,
      otherSectionTitle: "",
    });
    return sections.find((section) => section.workspaceId === workspaceId)?.sessions ?? [];
  }, [agents, workspaceId, workspaces]);

  const handleToggle = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  const handleViewAll = useCallback(() => {
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target: { kind: "sessions", workspaceId },
    });
  }, [serverId, workspaceId]);

  const toggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggleRow,
      (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [],
  );
  const viewAllStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.viewAllRow,
      (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [],
  );
  const chevronStyle = useMemo(
    () => [styles.chevron, expanded && styles.chevronExpanded],
    [expanded],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  if (sessions.length === 0) {
    return null;
  }

  const visibleSessions = expanded ? sessions.slice(0, MAX_SIDEBAR_SESSIONS) : [];

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleToggle}
        style={toggleStyle}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        testID={`sidebar-workspace-sessions-toggle-${workspaceKey}`}
      >
        <ThemedChevronRight size={10} uniProps={mutedColorMapping} style={chevronStyle} />
        <ThemedHistory size={11} uniProps={mutedColorMapping} />
        <Text style={styles.toggleLabel} numberOfLines={1}>
          {t("sidebarSessions.toggle")}
        </Text>
        <Text style={styles.toggleCount}>{sessions.length}</Text>
      </Pressable>
      {visibleSessions.map((session) => (
        <SidebarSessionRow
          key={session.id}
          session={session}
          serverId={serverId}
          workspaceId={workspaceId}
        />
      ))}
      {expanded && sessions.length > MAX_SIDEBAR_SESSIONS ? (
        <Pressable
          onPress={handleViewAll}
          style={viewAllStyle}
          accessibilityRole="button"
          testID={`sidebar-workspace-sessions-view-all-${workspaceKey}`}
        >
          <Text style={styles.viewAllText}>{t("sidebarSessions.viewAll")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedHistory = withUnistyles(History);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  chevron: {
    flexShrink: 0,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  toggleLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  toggleCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginLeft: "auto",
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
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
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  viewAllText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
  },
}));
