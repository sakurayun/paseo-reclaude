import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { GestureType } from "react-native-gesture-handler";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  Plus,
  Server,
  SquarePen,
  SquareTerminal,
} from "lucide-react-native";
import { isNative as platformIsNative } from "@/constants/platform";
import {
  useSidebarSessionsList,
  type SidebarSessionEntry,
} from "@/hooks/use-sidebar-sessions-list";
import {
  assignTerminalsToSidebarGroups,
  groupSidebarSessionsByProject,
  resolveSidebarSessionGroupWorkspaceTarget,
  type SidebarSessionGroup,
} from "@/hooks/sidebar-sessions-grouping";
import { useHostTerminals, type HostTerminalEntry } from "@/hooks/use-host-terminals";
import { SidebarSessionRow } from "@/components/sidebar/sidebar-workspace-sessions";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { isSidebarActiveAgent } from "@/utils/sidebar-agent-state";
import type { Theme } from "@/styles/theme";
import { useProjectNamesMap } from "@/hooks/use-status-mode-workspaces";
import { GitHubIcon } from "@/components/icons/github-icon";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatus,
  useHosts,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import {
  formatConnectionStatus,
  getConnectionStatusTone,
  type ConnectionStatusTone,
} from "@/utils/daemons";
import type { HostProfile } from "@/types/host-connection";
import { usePanelStore } from "@/stores/panel-store";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { isSyntheticTerminalWorkspaceId } from "@/utils/terminal-workspace-id";
import { OsBadge } from "@/components/ssh/os-badge";
import { useSshTerminalHostOs } from "@/screens/ssh/use-ssh-terminal-host-os";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

interface SidebarSessionsListProps {
  serverId: string | null;
  /** Native only: keep vertical scroll simultaneous with the sidebar-close pan. */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  /**
   * Multi-host only: start a new conversation on a given host (the host's "+"
   * button). Navigating there also makes that host active. Single-host mode
   * relies on the toolbar's new-chat instead, so this is optional.
   */
  onNewChatForHost?: (serverId: string) => void;
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
const HOST_HEADER_PRESS_SCALE = 0.97;
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit = withUnistyles(FolderGit2);
const ThemedGitHubIcon = withUnistyles(GitHubIcon);
const ThemedServer = withUnistyles(Server);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedPlus = withUnistyles(Plus);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const terminalRunningColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.green[500],
});
const terminalFailedColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });

type SidebarTerminalTone = "running" | "failed" | "idle";

function sidebarTerminalTone(terminal: HostTerminalEntry): SidebarTerminalTone {
  if (terminal.status === "exited") {
    return terminal.exitCode != null && terminal.exitCode !== 0 ? "failed" : "idle";
  }
  // Activity-driven: a connected-but-quiet shell (e.g. an idle SSH session) is
  // inactive and collapses with its group; only a running command, recent
  // input, or a needs-input prompt counts as running.
  return deriveTerminalActivityStatusBucket(terminal.activity) !== null ? "running" : "idle";
}

function sidebarTerminalIconMapping(tone: SidebarTerminalTone) {
  if (tone === "running") {
    return terminalRunningColorMapping;
  }
  if (tone === "failed") {
    return terminalFailedColorMapping;
  }
  return foregroundMutedColorMapping;
}

/** A session counts as "kept visible while collapsed" until it is fully done. */
function isSessionActive(session: SidebarSessionEntry): boolean {
  return isSidebarActiveAgent({
    status: session.status,
    pendingPermissionCount: session.pendingPermissionCount ?? 0,
    requiresAttention: session.requiresAttention,
    attentionReason: session.attentionReason,
  });
}

/** Collapse state shared by the project groups within a single host body. */
function useSidebarExpandedKeys() {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(EMPTY_EXPANDED);
  const toggle = useCallback((key: string) => {
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
  return { expandedKeys, toggle };
}

/**
 * New-theme default sidebar body. With a single host this is every non-archived
 * session on that host, grouped by project; with several hosts connected the
 * list groups by host first (each host is a collapsible section) and keeps the
 * project grouping nested inside. Groups start collapsed so the sidebar opens as
 * a compact index, but a collapsed host/project still surfaces its unfinished
 * (running / waiting / failed) sessions so live work across hosts is never
 * hidden. Sessions auto-refresh through react-query + the live session store.
 */
export function SidebarSessionsList({
  serverId,
  parentGestureRef,
  onNewChatForHost,
}: SidebarSessionsListProps) {
  const hosts = useHosts();
  if (hosts.length > 1) {
    return (
      <SidebarMultiHostSessions
        hosts={hosts}
        activeServerId={serverId}
        parentGestureRef={parentGestureRef}
        onNewChatForHost={onNewChatForHost}
      />
    );
  }
  return <SidebarSingleHostSessions serverId={serverId} parentGestureRef={parentGestureRef} />;
}

/** Cross-platform scroll surface shared by the single- and multi-host bodies. */
function SidebarSessionsScroll({
  children,
  parentGestureRef,
}: {
  children: ReactNode;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}) {
  const nativeScrollGestureProps = useMemo(
    () => (parentGestureRef ? ({ simultaneousHandlers: parentGestureRef } as object) : undefined),
    [parentGestureRef],
  );
  if (platformIsNative) {
    return (
      <NestableScrollContainer
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        testID="sidebar-sessions-list-scroll"
        {...nativeScrollGestureProps}
      >
        {children}
      </NestableScrollContainer>
    );
  }
  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      testID="sidebar-sessions-list-scroll"
    >
      {children}
    </ScrollView>
  );
}

function SidebarSingleHostSessions({ serverId, parentGestureRef }: SidebarSessionsListProps) {
  const { t } = useTranslation();
  const { sessions, isInitialLoad } = useSidebarSessionsList(serverId);
  const projectNamesByKey = useProjectNamesMap(serverId);
  const groups = useMemo(
    () => groupSidebarSessionsByProject(sessions, projectNamesByKey),
    [projectNamesByKey, sessions],
  );
  const { terminals } = useHostTerminals(serverId);
  const terminalsByGroupKey = useMemo(
    () => assignTerminalsToSidebarGroups(groups, terminals),
    [groups, terminals],
  );
  const { expandedKeys, toggle } = useSidebarExpandedKeys();

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

  return (
    <Animated.View entering={FadeIn.duration(200)} style={a.fill}>
      <SidebarSessionsScroll parentGestureRef={parentGestureRef}>
        <SidebarProjectGroups
          groups={groups}
          serverId={serverId}
          expandedKeys={expandedKeys}
          onToggle={toggle}
          unknownLabel={t("sidebar.sessionsList.unknownWorkspace")}
          terminalsByGroupKey={terminalsByGroupKey}
        />
      </SidebarSessionsScroll>
    </Animated.View>
  );
}

function SidebarMultiHostSessions({
  hosts,
  activeServerId,
  parentGestureRef,
  onNewChatForHost,
}: {
  hosts: HostProfile[];
  activeServerId: string | null;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  onNewChatForHost?: (serverId: string) => void;
}) {
  // Render hosts in their stable registry order — never reordered by which host
  // is active. Switching the active host (clicking a session on another host,
  // tapping its "+", or using the footer picker) must keep every host section
  // exactly where it was; the active host is distinguished visually, not by
  // position, so the list never jumps under the user.
  return (
    <Animated.View entering={FadeIn.duration(200)} style={a.fill}>
      <SidebarSessionsScroll parentGestureRef={parentGestureRef}>
        {hosts.map((host, index) => (
          <SidebarHostSection
            key={host.serverId}
            host={host}
            isActive={host.serverId === activeServerId}
            index={index}
            onNewChat={onNewChatForHost}
          />
        ))}
      </SidebarSessionsScroll>
    </Animated.View>
  );
}

/** One host's collapsible section: header + its project-grouped sessions. */
const SidebarHostSection = memo(function SidebarHostSection({
  host,
  isActive,
  index,
  onNewChat,
}: {
  host: HostProfile;
  isActive: boolean;
  index: number;
  onNewChat?: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { sessions, isInitialLoad } = useSidebarSessionsList(host.serverId);
  const projectNamesByKey = useProjectNamesMap(host.serverId);
  const groups = useMemo(
    () => groupSidebarSessionsByProject(sessions, projectNamesByKey),
    [projectNamesByKey, sessions],
  );
  const { terminals } = useHostTerminals(host.serverId);
  const terminalsByGroupKey = useMemo(
    () => assignTerminalsToSidebarGroups(groups, terminals),
    [groups, terminals],
  );
  const connectionStatus = useHostRuntimeConnectionStatus(host.serverId);
  const { expandedKeys, toggle } = useSidebarExpandedKeys();

  // Host sections start expanded so a multi-host user sees every host's work at
  // a glance; the project groups nested inside still start collapsed.
  const [expanded, setExpanded] = useState(true);
  const handleToggle = useCallback(() => setExpanded((value) => !value), []);

  const handleNewChat = useMemo(
    () => (onNewChat ? () => onNewChat(host.serverId) : undefined),
    [onNewChat, host.serverId],
  );

  const activeSessions = useMemo(() => sessions.filter(isSessionActive), [sessions]);
  const label = host.label.trim().length > 0 ? host.label : host.serverId;
  const unknownLabel = t("sidebar.sessionsList.unknownWorkspace");

  // Stagger the sections in on mount — a small cascade that assembles the list
  // rather than popping it in all at once. Capped so a long host list never
  // delays the tail noticeably, and skipped entirely under reduced motion.
  const entering = useMemo(
    () => (reduceMotion ? undefined : FadeInDown.duration(220).delay(Math.min(index, 6) * 50)),
    [index, reduceMotion],
  );

  let body: ReactNode = null;
  if (expanded) {
    if (isInitialLoad) {
      body = <SidebarAgentListSkeleton />;
    } else if (groups.length > 0) {
      body = (
        <SidebarProjectGroups
          groups={groups}
          serverId={host.serverId}
          expandedKeys={expandedKeys}
          onToggle={toggle}
          unknownLabel={unknownLabel}
          terminalsByGroupKey={terminalsByGroupKey}
        />
      );
    } else {
      body = <Text style={styles.hostEmptyText}>{t("sidebar.sessionsList.empty")}</Text>;
    }
  } else if (activeSessions.length > 0) {
    // Collapsed: still surface this host's live work so cross-host monitoring is
    // never lost behind a closed section.
    body = (
      <View style={styles.groupSessions}>
        {activeSessions.map((session) => (
          <SidebarSessionRow
            key={`${session.serverId}:${session.id}`}
            session={session}
            timeOverride={session.recencyAt}
            variant="flat"
          />
        ))}
      </View>
    );
  }

  return (
    <Animated.View entering={entering} style={styles.hostSection}>
      <SidebarHostHeader
        serverId={host.serverId}
        label={label}
        status={connectionStatus}
        count={sessions.length}
        expanded={expanded}
        isActive={isActive}
        reduceMotion={reduceMotion}
        onToggle={handleToggle}
        onNewChat={handleNewChat}
        newChatLabel={t("sidebar.sessionsList.newConversation")}
      />
      {body !== null ? (
        <Animated.View
          key={expanded ? "open" : "closed"}
          entering={reduceMotion ? undefined : FadeIn.duration(160)}
          style={styles.hostSectionBody}
        >
          {body}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

function SidebarHostHeader({
  serverId,
  label,
  status,
  count,
  expanded,
  isActive,
  reduceMotion,
  onToggle,
  onNewChat,
  newChatLabel,
}: {
  serverId: string;
  label: string;
  status: HostRuntimeConnectionStatus;
  count: number;
  expanded: boolean;
  isActive: boolean;
  reduceMotion: boolean;
  onToggle: () => void;
  onNewChat?: () => void;
  newChatLabel: string;
}) {
  const scale = useSharedValue(1);
  const rotation = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      rotation.value = expanded ? 1 : 0;
      return;
    }
    rotation.value = withTiming(expanded ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [expanded, reduceMotion, rotation]);

  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // Chevron points right when collapsed and rotates to point down when open.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 90}deg` }],
  }));

  const handlePressIn = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(HOST_HEADER_PRESS_SCALE, { duration: 90 });
  }, [reduceMotion, scale]);
  const handlePressOut = useCallback(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.5 });
  }, [reduceMotion, scale]);

  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.hostHeader,
      (Boolean(hovered) || pressed) && styles.hostHeaderHovered,
    ],
    [],
  );

  const iconMapping = isActive ? foregroundColorMapping : foregroundMutedColorMapping;
  const toggleStyle = useMemo(() => [a.hostHeaderToggle, scaleStyle], [scaleStyle]);
  const chevronContainerStyle = useMemo(() => [a.hostChevron, chevronStyle], [chevronStyle]);
  const labelStyle = useMemo(
    () => [styles.hostLabel, isActive && styles.hostLabelActive],
    [isActive],
  );
  const statusA11yValue = useMemo(() => ({ text: formatConnectionStatus(status) }), [status]);

  return (
    <View style={a.hostHeaderRow}>
      <Animated.View style={toggleStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={expandedState(expanded)}
          accessibilityValue={statusA11yValue}
          testID={`sidebar-host-section-${serverId}`}
          style={headerStyle}
          onPress={onToggle}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Animated.View style={chevronContainerStyle}>
            <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />
          </Animated.View>
          <ThemedServer size={14} uniProps={iconMapping} />
          <Text style={labelStyle} numberOfLines={1}>
            {label}
          </Text>
          <HostStatusDot status={status} reduceMotion={reduceMotion} />
          <Text style={styles.hostCount}>{count}</Text>
        </Pressable>
      </Animated.View>
      {onNewChat ? (
        <HostNewChatButton
          onPress={onNewChat}
          label={newChatLabel}
          reduceMotion={reduceMotion}
          testID={`sidebar-host-section-${serverId}-new-chat`}
        />
      ) : null}
    </View>
  );
}

/** Trailing "+" on a host header: start a new conversation on that host. */
function HostNewChatButton({
  onPress,
  label,
  reduceMotion,
  testID,
}: {
  onPress: () => void;
  label: string;
  reduceMotion: boolean;
  testID: string;
}) {
  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(0.9, { duration: 90 });
  }, [reduceMotion, scale]);
  const handlePressOut = useCallback(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.5 });
  }, [reduceMotion, scale]);

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.hostNewChatButton,
      (Boolean(hovered) || pressed) && styles.hostNewChatButtonHovered,
    ],
    [],
  );

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        hitSlop={8}
        style={buttonStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {({ hovered, pressed }) => (
          <ThemedSquarePen
            size={15}
            uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Trailing "+" on a project group header: open the new-agent page preselected to that project. */
function GroupNewAgentButton({
  onPress,
  label,
  reduceMotion,
  testID,
}: {
  onPress: () => void;
  label: string;
  reduceMotion: boolean;
  testID: string;
}) {
  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withTiming(0.9, { duration: 90 });
  }, [reduceMotion, scale]);
  const handlePressOut = useCallback(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.5 });
  }, [reduceMotion, scale]);

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.groupNewAgentButton,
      (Boolean(hovered) || pressed) && styles.groupNewAgentButtonHovered,
    ],
    [],
  );

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        hitSlop={8}
        style={buttonStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {({ hovered, pressed }) => (
          <ThemedPlus
            size={14}
            uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

function HostStatusDot({
  status,
  reduceMotion,
}: {
  status: HostRuntimeConnectionStatus;
  reduceMotion: boolean;
}) {
  const tone = getConnectionStatusTone(status);
  const pulse = useSharedValue(1);

  useEffect(() => {
    // Only "connecting" gets a gentle breathing pulse — it conveys in-progress
    // work (motion with meaning); settled states hold a steady dot.
    if (status === "connecting" && !reduceMotion) {
      pulse.value = withRepeat(
        withTiming(0.35, { duration: 850, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
    return () => cancelAnimation(pulse);
  }, [status, reduceMotion, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const dotStyle = useMemo(() => [styles.hostStatusDot, toneDotStyle(tone)], [tone]);

  return (
    <Animated.View
      style={pulseStyle}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <View style={dotStyle} />
    </Animated.View>
  );
}

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

/** Render a host's project groups (shared by single- and multi-host bodies). */
const NO_GROUP_TERMINALS: HostTerminalEntry[] = [];

function SidebarProjectGroups({
  groups,
  serverId,
  expandedKeys,
  onToggle,
  unknownLabel,
  terminalsByGroupKey,
}: {
  groups: SidebarSessionGroup[];
  serverId: string | null;
  expandedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  unknownLabel: string;
  terminalsByGroupKey?: ReadonlyMap<string, HostTerminalEntry[]>;
}) {
  return (
    <>
      {groups.map((group) => (
        <SidebarSessionsGroupView
          key={group.key}
          group={group}
          expanded={expandedKeys.has(group.key)}
          unknownLabel={unknownLabel}
          serverId={serverId}
          onToggle={onToggle}
          terminals={terminalsByGroupKey?.get(group.key) ?? NO_GROUP_TERMINALS}
        />
      ))}
    </>
  );
}

const SidebarSessionsGroupView = memo(function SidebarSessionsGroupView({
  group,
  expanded,
  unknownLabel,
  serverId,
  onToggle,
  terminals = NO_GROUP_TERMINALS,
}: {
  group: SidebarSessionGroup;
  expanded: boolean;
  unknownLabel: string;
  serverId: string | null;
  onToggle: (key: string) => void;
  terminals?: HostTerminalEntry[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const displayLabel = group.label.length > 0 ? group.label : unknownLabel;
  const baseLabel = group.baseLabel.length > 0 ? group.baseLabel : null;
  const showBaseLabel = Boolean(baseLabel && displayLabel !== baseLabel);
  const canRename = group.projectKey !== null && serverId !== null;
  const newAgentTarget = useMemo(
    () => resolveSidebarSessionGroupWorkspaceTarget(group, serverId),
    [group, serverId],
  );
  const canOpenNewAgent = canRename && newAgentTarget !== null;

  // Hover lives on a plain View (canonical pattern, see docs/hover.md): the
  // header's leading icon is a folder by default and swaps to the collapse
  // chevron on hover. The leading icon is its own Pressable that toggles the
  // group; pressing the title opens the workspace's tab view instead. Hover is
  // web-only, so native always shows the folder; tapping it still toggles.
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const handleOpenRename = useCallback(() => setIsRenameOpen(true), []);
  const handleCloseRename = useCallback(() => setIsRenameOpen(false), []);

  const handleToggle = useCallback(() => {
    onToggle(group.key);
  }, [group.key, onToggle]);

  // Pressing the title opens the workspace's tab view; expanding/collapsing is
  // reserved for the dedicated leading chevron button. Groups without a
  // resolvable workspace target keep the legacy toggle behavior.
  const handleOpenWorkspaceTabs = useCallback(() => {
    if (!newAgentTarget) {
      onToggle(group.key);
      return;
    }
    navigateToWorkspace({
      serverId: newAgentTarget.serverId,
      workspaceId: newAgentTarget.workspaceId,
    });
    usePanelStore.getState().showMobileAgent();
  }, [group.key, newAgentTarget, onToggle]);

  const reduceMotion = useReducedMotion();

  // Open a new-agent draft tab in the group's latest known workspace instead
  // of sending the user through the New workspace route.
  const handleNewAgent = useCallback(() => {
    if (!newAgentTarget) {
      return;
    }
    navigateToPreparedWorkspaceTab({
      ...newAgentTarget,
      target: { kind: "draft", draftId: "new" },
    });
    usePanelStore.getState().showMobileAgent();
  }, [newAgentTarget]);

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
      getHostRuntimeStore().refreshAllAgentDirectories({ serverIds: [serverId] });
      // Refresh history-derived placement labels so the rename surfaces for
      // sessions that aren't live in the session store.
      void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(serverId) });
    },
    [baseLabel, group.projectKey, serverId, queryClient, t],
  );

  // The header row carries the padding + hover background as a plain View, so
  // the two interactive controls inside it (the collapse toggle and the
  // open-tabs trigger) are siblings rather than nested buttons — nesting a
  // <button> inside a <button> is invalid HTML and breaks web hydration.
  const headerRowStyle = useMemo(
    () => [styles.groupHeader, isHovered && styles.groupHeaderHovered],
    [isHovered],
  );

  // Collapsed groups still surface their unfinished sessions so live work stays
  // visible; expanding reveals the full set.
  const visibleSessions = useMemo(
    () => (expanded ? group.sessions : group.sessions.filter(isSessionActive)),
    [expanded, group.sessions],
  );

  // Terminals mirror the sessions rule: collapsed groups keep only actively
  // running terminals visible (a quiet shell counts as inactive); expanding
  // reveals the idle and exited ones too.
  const visibleTerminals = useMemo(
    () =>
      expanded
        ? terminals
        : terminals.filter((terminal) => sidebarTerminalTone(terminal) === "running"),
    [expanded, terminals],
  );

  // Extracted so the header's label Text stays within the JSX nesting budget.
  const baseLabelSuffix = showBaseLabel ? (
    <Text style={styles.groupBaseLabel}> {baseLabel}</Text>
  ) : null;

  return (
    <View style={styles.group}>
      <View style={a.groupHeaderRow}>
        <View
          style={styles.groupHeaderHoverTracker}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <View style={headerRowStyle}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={displayLabel}
              accessibilityState={expandedState(expanded)}
              onPress={handleToggle}
              hitSlop={6}
              style={styles.groupHeaderLeadingSlot}
              testID={`sidebar-sessions-group-${group.key}-toggle`}
            >
              <GroupLeadingIcon hovered={isHovered} expanded={expanded} iconKind={group.iconKind} />
            </Pressable>
            <ContextMenu>
              <ContextMenuTrigger
                accessibilityRole="button"
                accessibilityLabel={displayLabel}
                style={styles.groupHeaderTrigger}
                onPress={handleOpenWorkspaceTabs}
                testID={`sidebar-sessions-group-${group.key}`}
              >
                <Text style={styles.groupLabel} numberOfLines={1}>
                  {displayLabel}
                  {baseLabelSuffix}
                </Text>
                <Text style={styles.groupCount}>{group.sessions.length + terminals.length}</Text>
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
        </View>
        {canOpenNewAgent ? (
          <GroupNewAgentButton
            onPress={handleNewAgent}
            label={t("sidebar.sessionsList.newAgentInWorkspace")}
            reduceMotion={reduceMotion}
            testID={`sidebar-sessions-group-${group.key}-new-agent`}
          />
        ) : null}
      </View>
      {visibleSessions.length > 0 || visibleTerminals.length > 0 ? (
        <View style={styles.groupSessions}>
          {visibleSessions.map((session) => (
            <SidebarSessionRow
              key={`${session.serverId}:${session.id}`}
              session={session}
              timeOverride={session.recencyAt}
              variant="flat"
            />
          ))}
          {visibleTerminals.map((terminal) => (
            <SidebarTerminalRow
              key={`terminal:${terminal.id}`}
              terminal={terminal}
              workspaceTarget={newAgentTarget}
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

/**
 * One terminal in a project group. The icon carries the lifecycle tone:
 * green while running, red after a non-zero exit, muted after a clean exit.
 * Pressing opens (or focuses) the terminal's tab in its workspace.
 */
const SidebarTerminalRow = memo(function SidebarTerminalRow({
  terminal,
  workspaceTarget,
}: {
  terminal: HostTerminalEntry;
  workspaceTarget: { serverId: string; workspaceId: string } | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isKilling, setIsKilling] = useState(false);

  const tone = sidebarTerminalTone(terminal);
  const label = terminal.title?.trim() || terminal.name;
  const { isSsh: isSshTerminal, os: sshHostOs } = useSshTerminalHostOs(
    workspaceTarget?.serverId ?? null,
    terminal.id,
  );

  // Synthetic ids aren't real workspaces — fall back to the group's workspace
  // target for navigation.
  const terminalWorkspaceId =
    terminal.workspaceId && !isSyntheticTerminalWorkspaceId(terminal.workspaceId)
      ? terminal.workspaceId
      : null;
  const serverId = workspaceTarget?.serverId ?? null;
  const workspaceId = terminalWorkspaceId ?? workspaceTarget?.workspaceId ?? null;

  const handlePress = useCallback(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target: { kind: "terminal", terminalId: terminal.id },
    });
    usePanelStore.getState().showMobileAgent();
  }, [serverId, workspaceId, terminal.id]);

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);
  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);
  const handleRenameSubmit = useCallback(
    async (nextTitle: string) => {
      const client = serverId
        ? (useSessionStore.getState().sessions[serverId]?.client ?? null)
        : null;
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const result = await client.renameTerminal({
        terminalId: terminal.id,
        title: nextTitle.trim(),
      });
      if (!result.success) {
        throw new Error(result.error ?? "Failed to rename terminal");
      }
      // The daemon's terminals_changed push refreshes the sidebar list.
    },
    [serverId, t, terminal.id],
  );

  const handleKill = useCallback(() => {
    if (isKilling) {
      return;
    }
    const client = serverId
      ? (useSessionStore.getState().sessions[serverId]?.client ?? null)
      : null;
    if (!client) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return;
    }
    setIsKilling(true);
    const killTerminal = async (): Promise<void> => {
      const payload = await client.killTerminal(terminal.id);
      if (!payload.success) {
        throw new Error("Unable to close terminal");
      }
    };
    void killTerminal()
      .catch((error: unknown) => {
        toast.error(toErrorMessage(error));
      })
      .finally(() => {
        setIsKilling(false);
      });
  }, [isKilling, serverId, t, terminal.id, toast]);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.terminalRow,
      (isHovered || pressed) && styles.groupHeaderHovered,
    ],
    [isHovered],
  );

  const titleStyle = useMemo(
    () => [
      styles.terminalRowTitle,
      tone === "idle" && styles.terminalRowTitleExited,
      tone === "failed" && styles.terminalRowTitleFailed,
    ],
    [tone],
  );

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <ContextMenu>
        <ContextMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={label}
          style={rowStyle}
          onPress={handlePress}
          testID={`sidebar-terminal-${terminal.id}`}
        >
          <View style={styles.groupHeaderLeadingSlot}>
            {isSshTerminal ? (
              <OsBadge os={sshHostOs} size={16} />
            ) : (
              <ThemedSquareTerminal size={14} uniProps={sidebarTerminalIconMapping(tone)} />
            )}
          </View>
          <Text style={titleStyle} numberOfLines={1}>
            {label}
          </Text>
        </ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={200}
          mobileMode="sheet"
          testID={`sidebar-terminal-context-${terminal.id}`}
        >
          <ContextMenuItem
            testID={`sidebar-terminal-context-${terminal.id}-rename`}
            onSelect={handleOpenRename}
          >
            {t("workspace.tabs.menu.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            testID={`sidebar-terminal-context-${terminal.id}-kill`}
            status={isKilling ? "pending" : "idle"}
            pendingLabel={t("workspace.tabs.closePrompt.killTerminalLabel")}
            destructive
            onSelect={handleKill}
          >
            {t("workspace.tabs.closePrompt.killTerminalLabel")}
          </ContextMenuItem>
        </ContextMenuContent>
        <AdaptiveRenameModal
          visible={isRenameOpen}
          title={t("workspace.tabs.menu.rename")}
          initialValue={label}
          submitLabel={t("workspace.tabs.menu.rename")}
          onClose={handleCloseRename}
          onSubmit={handleRenameSubmit}
          testID={`sidebar-terminal-rename-${terminal.id}`}
        />
      </ContextMenu>
    </View>
  );
});

function expandedState(expanded: boolean) {
  return { expanded } as const;
}

function toneDotStyle(tone: ConnectionStatusTone) {
  switch (tone) {
    case "success":
      return styles.hostStatusDotSuccess;
    case "warning":
      return styles.hostStatusDotWarning;
    case "error":
      return styles.hostStatusDotError;
    default:
      return styles.hostStatusDotMuted;
  }
}

const a = RNStyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  // Host header row: collapsible toggle area + trailing "+" new-chat button.
  hostHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  hostHeaderToggle: {
    flex: 1,
    minWidth: 0,
  },
  // Fixed slot so the rotating chevron never nudges the host label.
  hostChevron: {
    width: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  // Group header: collapsible toggle area + trailing "+" new-agent button.
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
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
  hostSection: {
    marginBottom: theme.spacing[2],
  },
  // Nest the host's project groups slightly under its header.
  hostSectionBody: {
    paddingLeft: theme.spacing[1],
  },
  hostHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.shell.contentRadius,
  },
  hostHeaderHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  hostLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  hostLabelActive: {
    fontWeight: theme.fontWeight.semibold,
  },
  hostCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
  },
  hostStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  hostStatusDotSuccess: {
    backgroundColor: theme.colors.palette.green[400],
  },
  hostStatusDotWarning: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  hostStatusDotError: {
    backgroundColor: theme.colors.palette.red[500],
  },
  hostStatusDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  hostNewChatButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    marginLeft: theme.spacing[1],
  },
  hostNewChatButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  hostEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  group: {
    marginBottom: theme.spacing[1],
  },
  // Plain hover-tracker wrapper — a relative box that flex-grows so the trailing
  // "+" button sits at the far right (see docs/hover.md).
  groupHeaderHoverTracker: {
    position: "relative",
    flex: 1,
    minWidth: 0,
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
  // The open-tabs trigger fills the row beside the collapse toggle; label +
  // count lay out as a row inside it.
  groupHeaderTrigger: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // Trailing "+" on a project group header — sized for the 32px group row.
  groupNewAgentButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    marginLeft: theme.spacing[1],
    flexShrink: 0,
  },
  groupNewAgentButtonHovered: {
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
  terminalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 30,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.shell.contentRadius,
  },
  terminalRowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  terminalRowTitleExited: {
    color: theme.colors.foregroundMuted,
  },
  terminalRowTitleFailed: {
    color: theme.colors.palette.red[500],
  },
  groupCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
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
