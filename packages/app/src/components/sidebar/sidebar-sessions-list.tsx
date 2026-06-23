import { memo, useCallback, useMemo, useState, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { GestureType } from "react-native-gesture-handler";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Folder, FolderGit2 } from "lucide-react-native";
import { isNative as platformIsNative } from "@/constants/platform";
import {
  useSidebarSessionsList,
  type SidebarSessionEntry,
} from "@/hooks/use-sidebar-sessions-list";
import {
  groupSidebarSessionsByProject,
  type SidebarSessionGroup,
} from "@/hooks/sidebar-sessions-grouping";
import { SidebarSessionRow } from "@/components/sidebar/sidebar-workspace-sessions";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import type { Theme } from "@/styles/theme";
import { useProjectNamesMap } from "@/hooks/use-status-mode-workspaces";
import { projectsQueryKey } from "@/hooks/use-projects";
import { GitHubIcon } from "@/components/icons/github-icon";

interface SidebarSessionsListProps {
  serverId: string | null;
  /** Native only: keep vertical scroll simultaneous with the sidebar-close pan. */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit = withUnistyles(FolderGit2);
const ThemedGitHubIcon = withUnistyles(GitHubIcon);

/** A session counts as "kept visible while collapsed" until it is fully done. */
function isSessionActive(session: SidebarSessionEntry): boolean {
  return isSidebarActiveAgent({
    status: session.status,
    pendingPermissionCount: session.pendingPermissionCount ?? 0,
    requiresAttention: session.requiresAttention,
    attentionReason: session.attentionReason,
  });
}

/** Project icon by default; swaps to the collapse chevron on hover (web only). */
function GroupLeadingIcon({
  hovered,
  expanded,
  iconKind,
}: {
  hovered: boolean;
  expanded: boolean;
  iconKind: SidebarSessionGroup["iconKind"];
}) {
  if (!hovered) {
    if (iconKind === "github") {
      return <ThemedGitHubIcon size={14} uniProps={foregroundMutedColorMapping} />;
    }
    if (iconKind === "git-folder") {
      return <ThemedFolderGit size={14} uniProps={foregroundMutedColorMapping} />;
    }
    return <ThemedFolder size={14} uniProps={foregroundMutedColorMapping} />;
  }
  if (expanded) {
    return <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />;
  }
  return <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />;
}

/**
 * New-theme default sidebar body: every non-archived session on the active host,
 * grouped by project. Groups are sorted by recency (the group holding the most
 * recent session leads) and start collapsed, so the sidebar opens as a compact
 * index of projects the user can drill into. A collapsed group still shows its
 * unfinished (running / waiting / failed) sessions so live work is never hidden.
 * Sessions auto-refresh through react-query + the live session store, so no
 * manual refresh control is needed here.
 */
export function SidebarSessionsList({ serverId, parentGestureRef }: SidebarSessionsListProps) {
  const { t } = useTranslation();
  const { sessions, isInitialLoad } = useSidebarSessionsList(serverId);
  const projectNamesByKey = useProjectNamesMap(serverId);

  const groups = useMemo(
    () => groupSidebarSessionsByProject(sessions, projectNamesByKey),
    [projectNamesByKey, sessions],
  );
  // Expanded-by-key set, empty by default → all groups start collapsed. Newly
  // appearing groups are absent from the set, so they stay collapsed too.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(EMPTY_EXPANDED);

  const handleToggle = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const nativeScrollGestureProps = useMemo(
    () => (parentGestureRef ? ({ simultaneousHandlers: parentGestureRef } as object) : undefined),
    [parentGestureRef],
  );

  if (isInitialLoad) {
    return <SidebarAgentListSkeleton />;
  }

  if (groups.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t("sidebar.sessionsList.empty")}</Text>
      </View>
    );
  }

  const unknownLabel = t("sidebar.sessionsList.unknownWorkspace");
  const rows = groups.map((group) => (
    <SidebarSessionsGroupView
      key={group.key}
      group={group}
      expanded={expandedKeys.has(group.key)}
      unknownLabel={unknownLabel}
      serverId={serverId}
      onToggle={handleToggle}
    />
  ));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={a.fill}>
      {platformIsNative ? (
        <NestableScrollContainer
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-sessions-list-scroll"
          {...nativeScrollGestureProps}
        >
          {rows}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-sessions-list-scroll"
        >
          {rows}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const SidebarSessionsGroupView = memo(function SidebarSessionsGroupView({
  group,
  expanded,
  unknownLabel,
  serverId,
  onToggle,
}: {
  group: SidebarSessionGroup;
  expanded: boolean;
  unknownLabel: string;
  serverId: string | null;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const displayLabel = group.label.length > 0 ? group.label : unknownLabel;
  const baseLabel = group.baseLabel.length > 0 ? group.baseLabel : null;
  const showBaseLabel = Boolean(baseLabel && displayLabel !== baseLabel);
  const canRename = group.projectKey !== null && serverId !== null;

  // Hover lives on a plain View (canonical pattern, see docs/hover.md): the
  // header's leading icon is a folder by default and swaps to the collapse
  // chevron on hover. Hover is web-only, so native always shows the folder and
  // toggles on tap. isHovered drives both the icon swap and the header tint.
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const handleOpenRename = useCallback(() => setIsRenameOpen(true), []);
  const handleCloseRename = useCallback(() => setIsRenameOpen(false), []);

  const handleToggle = useCallback(() => {
    onToggle(group.key);
  }, [group.key, onToggle]);

  const handleRenameSubmit = useCallback(
    async (nextTitle: string) => {
      if (!group.projectKey || !serverId) {
        return;
      }
      const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const trimmed = nextTitle.trim();
      const customName = trimmed === baseLabel ? null : trimmed;
      await client.renameProject(group.projectKey, customName);
      void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      // Refresh history-derived placement labels so the rename surfaces for
      // sessions that aren't live in the session store.
      void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(serverId) });
    },
    [baseLabel, group.projectKey, serverId, queryClient, t],
  );

  const headerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.groupHeader,
      (isHovered || pressed) && styles.groupHeaderHovered,
    ],
    [isHovered],
  );

  // Collapsed groups still surface their unfinished sessions so live work stays
  // visible; expanding reveals the full set.
  const visibleSessions = useMemo(
    () => (expanded ? group.sessions : group.sessions.filter(isSessionActive)),
    [expanded, group.sessions],
  );

  return (
    <View style={styles.group}>
      <View
        style={styles.groupHeaderHoverTracker}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenu>
          <ContextMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={displayLabel}
            accessibilityState={expandedState(expanded)}
            style={headerStyle}
            onPress={handleToggle}
            testID={`sidebar-sessions-group-${group.key}`}
          >
            <View style={styles.groupHeaderLeadingSlot}>
              <GroupLeadingIcon hovered={isHovered} expanded={expanded} iconKind={group.iconKind} />
            </View>
            <Text style={styles.groupLabel} numberOfLines={1}>
              {displayLabel}
              {showBaseLabel ? <Text style={styles.groupBaseLabel}> {baseLabel}</Text> : null}
            </Text>
            <Text style={styles.groupCount}>{group.sessions.length}</Text>
          </ContextMenuTrigger>
          {canRename ? (
            <ContextMenuContent
              align="start"
              width={200}
              mobileMode="sheet"
              testID={`sidebar-sessions-group-context-${group.key}`}
            >
              <ContextMenuItem
                testID={`sidebar-sessions-group-context-${group.key}-rename`}
                onSelect={handleOpenRename}
              >
                {t("settings.project.rename.renameLabel")}
              </ContextMenuItem>
            </ContextMenuContent>
          ) : null}
        </ContextMenu>
      </View>
      {visibleSessions.length > 0 ? (
        <View style={styles.groupSessions}>
          {visibleSessions.map((session) => (
            <SidebarSessionRow
              key={`${session.serverId}:${session.id}`}
              session={session}
              timeOverride={session.recencyAt}
              variant="flat"
            />
          ))}
        </View>
      ) : null}
      {canRename ? (
        <AdaptiveRenameModal
          visible={isRenameOpen}
          title={t("settings.project.rename.renameLabel")}
          initialValue={displayLabel}
          placeholder={baseLabel ?? undefined}
          onClose={handleCloseRename}
          onSubmit={handleRenameSubmit}
          testID={`sidebar-sessions-group-rename-${group.key}`}
        />
      ) : null}
    </View>
  );
});

function expandedState(expanded: boolean) {
  return { expanded } as const;
}

const a = RNStyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[4],
  },
  group: {
    marginBottom: theme.spacing[1],
  },
  // Plain hover-tracker wrapper — nothing but a relative box (see docs/hover.md).
  groupHeaderHoverTracker: {
    position: "relative",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 32,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.shell.contentRadius,
  },
  groupHeaderHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // Fixed slot so the folder↔chevron swap on hover never shifts the row.
  groupHeaderLeadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  groupLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  groupBaseLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  groupCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  // Indent the sessions so they read as nested under their workspace header.
  groupSessions: {
    paddingLeft: theme.spacing[2],
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[8],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
