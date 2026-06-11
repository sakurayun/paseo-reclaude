import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, History } from "lucide-react-native";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
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
  onOpen: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(session.id), [onOpen, session.id]);
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
  const { serverId, target, openTab } = usePaneContext();
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

  const handleOpenSession = useCallback(
    (agentId: string) => {
      openTab({ kind: "agent", agentId });
    },
    [openTab],
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

  const hasAnySession = sections.some((section) => section.sessions.length > 0);

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
