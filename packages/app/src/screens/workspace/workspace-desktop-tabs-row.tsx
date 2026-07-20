import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  CopyX,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  Columns2,
  Copy,
  Pencil,
  RotateCw,
  Rows2,
  Globe,
  Plus,
  Cable,
  SquarePen,
  SquareTerminal,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { SortableInlineList } from "@/components/sortable-inline-list";
import type {
  DraggableListDragHandleProps,
  DraggableRenderItemInfo,
} from "@/components/draggable-list.types";
import { isNative, isWeb } from "@/constants/platform";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import {
  WorkspaceTabPresentationResolver,
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import {
  buildWorkspaceDesktopTabActions,
  type WorkspaceDesktopTabActions,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Theme } from "@/styles/theme";
import { RenderProfile } from "@/utils/render-profiler";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@getpaseo/protocol/terminal-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { getProviderIcon } from "@/components/provider-icons";
import { useSubagentsForParent, type SubagentRow } from "@/subagents";
import {
  buildSubagentRowPresentationData,
  formatHeaderLabel,
} from "@/subagents/track-presentation";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { ProfileIcon, usePinnedLaunchers } from "@/workspace-pins/launch";
import { runPinnedTabTarget, type TabTargetHandlers } from "@/workspace-pins/run";
import type { PinnedTabTarget } from "@/workspace-pins/target";
import { PinnedTargetsRow } from "@/workspace-pins/pinned-targets-row";
import { PinnableMenuItem } from "@/workspace-pins/pinnable-menu-item";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { resolveWorkspaceTabWheelScroll } from "@/screens/workspace/workspace-tab-wheel-scroll";
import {
  TAB_GROUP_COLOR_HEX,
  TAB_GROUP_COLOR_IDS,
  type TabGroupColorId,
  type TabGroupVisualRole,
  type WorkspaceTabGroup,
} from "@/workspace-tabs/tab-groups";
import { AdaptiveRenameModal } from "@/components/rename-modal";

const DROPDOWN_WIDTH = 220;
const LOADING_TAB_LABEL_SKELETON_WIDTH = 80;
const DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH = 36;

const WORKSPACE_TAB_DATA_SET = { workspaceTab: "true" } as const;
const WORKSPACE_TAB_ICON_DATA_SET = { workspaceTabIcon: "true" } as const;
const WORKSPACE_TAB_LABEL_DATA_SET = { workspaceTabLabel: "true" } as const;
const WORKSPACE_TAB_CLOSE_DATA_SET = { workspaceTabClose: "true" } as const;
const WORKSPACE_TAB_ACTION_DATA_SET = { workspaceTabAction: "true" } as const;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedX = withUnistyles(X);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedGlobe = withUnistyles(Globe);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const ThemedPlus = withUnistyles(Plus);
const ThemedCable = withUnistyles(Cable);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const AGENT_ICON = <ThemedSquarePen size={14} uniProps={mutedColorMapping} />;
const TERMINAL_ICON = <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
const BROWSER_ICON = <ThemedGlobe size={14} uniProps={mutedColorMapping} />;
const PORT_FORWARD_ICON = <ThemedCable size={14} uniProps={mutedColorMapping} />;

const DRAFT_TARGET: PinnedTabTarget = { kind: "draft" };
const TERMINAL_TARGET: PinnedTabTarget = { kind: "terminal" };
const BROWSER_TARGET: PinnedTabTarget = { kind: "browser" };

function newTabActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.newTabActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function inlineAddActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.inlineAddActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function updateMeasuredWidth(setWidth: Dispatch<SetStateAction<number>>, event: LayoutChangeEvent) {
  const nextWidth = Math.round(event.nativeEvent.layout.width);
  setWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
}

function ProfileLeadingIcon({ iconKey }: { iconKey: string | undefined }) {
  return (
    <View style={styles.terminalProfileIconWrapper}>
      <ProfileIcon iconKey={iconKey} />
    </View>
  );
}

interface PinnableProfileMenuItemProps {
  profile: { id: string; name: string; command: string; args?: string[]; icon?: string };
  disabled?: boolean;
  onLaunch: (target: PinnedTabTarget) => void;
}

function PinnableProfileMenuItem({ profile, disabled, onLaunch }: PinnableProfileMenuItemProps) {
  const target = useMemo<PinnedTabTarget>(
    () => ({ kind: "profile", profileId: profile.id }),
    [profile.id],
  );
  const leading = useMemo(
    () => <ProfileLeadingIcon iconKey={getTerminalProfileIcon(profile)} />,
    [profile],
  );
  const handleSelect = useCallback(() => onLaunch(target), [onLaunch, target]);

  return (
    <PinnableMenuItem
      target={target}
      label={profile.name}
      leading={leading}
      disabled={disabled}
      onSelect={handleSelect}
    />
  );
}

interface WorkspaceInlineAddTabButtonProps {
  shortcutKeys: ShortcutKey[][] | null;
  onCreateAgentTab: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}

function WorkspaceInlineAddTabButton({
  shortcutKeys,
  onCreateAgentTab,
  onLayout,
}: WorkspaceInlineAddTabButtonProps) {
  const { t } = useTranslation();
  const tooltipText = t("workspace.tabs.actions.newAgent");

  return (
    <View style={styles.inlineAddButton} onLayout={onLayout}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger
          testID="workspace-new-agent-tab-inline"
          onPress={onCreateAgentTab}
          accessibilityRole="button"
          accessibilityLabel={tooltipText}
          dataSet={WORKSPACE_TAB_ACTION_DATA_SET}
          style={isWeb ? styles.inlineAddActionButton : inlineAddActionButtonStyle}
        >
          <ThemedPlus size={14} uniProps={mutedColorMapping} />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.newTabTooltipRow}>
            <Text style={styles.newTabTooltipText}>{tooltipText}</Text>
            {shortcutKeys ? (
              <Shortcut chord={shortcutKeys} style={styles.newTabTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

interface WorkspaceTabRowExtrasProps {
  onCreateAgentTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
  onEditProfiles: () => void;
  onCreatePortForwards: () => void;
  normalizedServerId: string;
  showCreateBrowserTab: boolean;
  terminalDisabled: boolean;
}

function WorkspaceTabRowExtras({
  onCreateAgentTab,
  onCreateTerminal,
  onCreateBrowser,
  onCreateTerminalWithProfile,
  onEditProfiles,
  onCreatePortForwards,
  normalizedServerId,
  showCreateBrowserTab,
  terminalDisabled,
}: WorkspaceTabRowExtrasProps) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(normalizedServerId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );

  const handlers = useMemo<TabTargetHandlers>(
    () => ({
      createDraft: onCreateAgentTab,
      createTerminal: onCreateTerminal,
      createBrowser: onCreateBrowser,
      createTerminalWithProfile: onCreateTerminalWithProfile,
    }),
    [onCreateAgentTab, onCreateBrowser, onCreateTerminal, onCreateTerminalWithProfile],
  );

  const onLaunch = useCallback(
    (target: PinnedTabTarget) => {
      runPinnedTabTarget(target, profiles, handlers);
    },
    [handlers, profiles],
  );

  const launchers = usePinnedLaunchers({ serverId: normalizedServerId, onLaunch });

  return (
    <>
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-new-tab-menu-trigger"
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.moreActions")}
              dataSet={WORKSPACE_TAB_ACTION_DATA_SET}
              style={isWeb ? styles.newTabActionButton : newTabActionButtonStyle}
            >
              <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <Text style={styles.newTabTooltipText}>{t("workspace.tabs.actions.moreActions")}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={200}>
          <PinnableMenuItem
            testID="workspace-new-tab-menu-agent"
            target={DRAFT_TARGET}
            label={t("workspace.tabs.actions.newAgent")}
            leading={AGENT_ICON}
            onSelect={onCreateAgentTab}
          />
          <PinnableMenuItem
            testID="workspace-new-tab-menu-terminal"
            target={TERMINAL_TARGET}
            label={t("workspace.tabs.actions.newTerminal")}
            leading={TERMINAL_ICON}
            disabled={terminalDisabled}
            onSelect={terminalDisabled ? undefined : onCreateTerminal}
          />
          {showCreateBrowserTab ? (
            <PinnableMenuItem
              testID="workspace-new-tab-menu-browser"
              target={BROWSER_TARGET}
              label={t("workspace.tabs.actions.newBrowser")}
              leading={BROWSER_ICON}
              onSelect={onCreateBrowser}
            />
          ) : null}
          <DropdownMenuItem
            testID="workspace-new-tab-menu-port-forwards"
            leading={PORT_FORWARD_ICON}
            onSelect={onCreatePortForwards}
          >
            {t("workspace.tabs.actions.newPortForward")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
          {profiles.map((profile) => (
            <PinnableProfileMenuItem
              key={profile.id}
              profile={profile}
              disabled={terminalDisabled}
              onLaunch={onLaunch}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem testID="workspace-new-tab-menu-edit-profiles" onSelect={onEditProfiles}>
            {t("workspace.tabs.actions.editTerminalProfiles")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PinnedTargetsRow launchers={launchers} testIdPrefix="workspace-pinned-target" />
    </>
  );
}

function TabContextMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "copy":
        return <ThemedCopy size={16} uniProps={mutedColorMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
      case "copy-x":
        return <ThemedCopyX size={16} uniProps={mutedColorMapping} />;
      case "pencil":
        return <ThemedPencil size={16} uniProps={mutedColorMapping} />;
      case "x":
        return <ThemedX size={16} uniProps={mutedColorMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <ContextMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </ContextMenuItem>
  );
}

function tabKeyExtractor(item: WorkspaceDesktopTabRowItem) {
  if (item.kind === "collapsed-group") {
    return `group:${item.group.id}`;
  }
  if (item.kind === "group-header") {
    return `group-header:${item.group.id}`;
  }
  return `${item.tab.key}:${item.tab.kind}`;
}

export type WorkspaceDesktopTabRowItem =
  | {
      kind: "tab";
      tab: WorkspaceTabDescriptor;
      isActive: boolean;
      isCloseHovered: boolean;
      isClosingTab: boolean;
      groupId?: string | null;
      groupRole?: TabGroupVisualRole;
      group?: WorkspaceTabGroup;
    }
  | {
      /** Expanded-group color chip: own flex width in the tab row (not nested in a tab). */
      kind: "group-header";
      group: WorkspaceTabGroup;
    }
  | {
      kind: "collapsed-group";
      group: WorkspaceTabGroup;
      memberTabs: WorkspaceTabDescriptor[];
      isActive: boolean;
      activeMember: WorkspaceTabDescriptor;
    };

function groupLineEdgeStyle(role: Exclude<TabGroupVisualRole | "header", "none">) {
  switch (role) {
    case "header":
      return groupStyles.groupBottomLineHeader;
    case "start":
      return groupStyles.groupBottomLineStart;
    case "middle":
      return groupStyles.groupBottomLineMiddle;
    case "end":
      return groupStyles.groupBottomLineEnd;
    case "only":
      return groupStyles.groupBottomLineOnly;
  }
}

/**
 * Continuous group underline segment. Adjacent members extend into the tab-row
 * gap so separate chips still read as one connected bar (not per-tab dashes).
 */
function GroupMembershipLine({
  color,
  role,
}: {
  color: string;
  role: TabGroupVisualRole | "header";
}) {
  const lineStyle = useMemo(() => {
    if (role === "none") {
      return null;
    }
    return [groupStyles.groupBottomLine, groupLineEdgeStyle(role), { backgroundColor: color }];
  }, [color, role]);

  if (!lineStyle) {
    return null;
  }
  return <View pointerEvents="none" style={lineStyle} />;
}

interface SplitActionButtonProps {
  onPress: () => void;
  label: string;
  shortcutKeys: ShortcutKey[][] | null;
  icon: "split-right" | "split-down";
}

function SplitActionButton({ onPress, label, shortcutKeys, icon }: SplitActionButtonProps) {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        dataSet={WORKSPACE_TAB_ACTION_DATA_SET}
        style={isWeb ? styles.newTabActionButton : newTabActionButtonStyle}
      >
        {icon === "split-right" ? (
          <ThemedColumns2 size={14} uniProps={mutedColorMapping} />
        ) : (
          <ThemedRows2 size={14} uniProps={mutedColorMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={8}>
        <View style={styles.newTabTooltipRow}>
          <Text style={styles.newTabTooltipText}>{label}</Text>
          {shortcutKeys ? (
            <Shortcut chord={shortcutKeys} style={styles.newTabTooltipShortcut} />
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

interface WorkspaceDesktopTabsRowProps {
  paneId?: string;
  isFocused?: boolean;
  tabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onToggleGroupCollapsed?: (groupId: string, collapsed: boolean) => void;
  onRenameGroup?: (groupId: string, title: string) => void;
  onSetGroupColor?: (groupId: string, color: string) => void;
  onUngroup?: (groupId: string) => void;
  groupDropTargetTabId?: string | null;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onCreateDraftTab: (input: { paneId?: string }) => void;
  onCreateTerminalTab: (input: { paneId?: string; profile?: TerminalProfileInput }) => void;
  onCreateBrowserTab: (input: { paneId?: string }) => void;
  showCreateBrowserTab?: boolean;
  disableCreateTerminal?: boolean;
  isWaitingOnTerminalReadiness?: boolean;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabDropPreviewIndex?: number | null;
  showPaneSplitActions?: boolean;
  focusModeEnabled: boolean;
  onExitFocusMode: () => void;
}

function getFallbackTabLabel(
  tab: WorkspaceTabDescriptor,
  labels: { newAgent: string; setup: string; terminal: string; agent: string },
): string {
  if (tab.target.kind === "draft") {
    return labels.newAgent;
  }
  if (tab.target.kind === "setup") {
    return labels.setup;
  }
  if (tab.target.kind === "terminal") {
    return labels.terminal;
  }
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  return labels.agent;
}

function useMiddleClickClose(onClose: () => void) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (isNative) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    function handleAuxClick(event: MouseEvent) {
      if (event.button === 1) {
        event.preventDefault();
        onClose();
      }
    }

    node.addEventListener("auxclick", handleAuxClick);
    return () => node.removeEventListener("auxclick", handleAuxClick);
  }, [onClose]);

  return ref;
}

function TabHandleContent({
  presentation,
  isHighlighted,
  showLabel,
  tabLabelSkeletonStyle,
  tabLabelStyle,
}: {
  presentation: WorkspaceTabPresentation;
  isHighlighted: boolean;
  showLabel: boolean;
  tabLabelSkeletonStyle: React.ComponentProps<typeof View>["style"];
  tabLabelStyle: React.ComponentProps<typeof Text>["style"];
}) {
  const tabHandleDataSet = useMemo(
    () => ({ statusBucket: presentation.statusBucket ?? "none" }),
    [presentation.statusBucket],
  );

  return (
    <View style={styles.tabHandle} dataSet={tabHandleDataSet}>
      <View style={styles.tabIcon} dataSet={WORKSPACE_TAB_ICON_DATA_SET}>
        <WorkspaceTabIcon presentation={presentation} active={isHighlighted} />
      </View>
      {showLabel && presentation.titleState === "loading" ? (
        <View style={tabLabelSkeletonStyle} />
      ) : null}
      {showLabel && presentation.titleState !== "loading" ? (
        <Text
          style={tabLabelStyle}
          dataSet={WORKSPACE_TAB_LABEL_DATA_SET}
          selectable={false}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {presentation.label}
        </Text>
      ) : null}
    </View>
  );
}

function TabSubagentItem({ row, onOpen }: { row: SubagentRow; onOpen: (agentId: string) => void }) {
  const { t } = useTranslation();
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      ...buildSubagentRowPresentationData(row),
      icon: getProviderIcon(row.provider),
    }),
    [row],
  );
  const displayLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const handleSelect = useCallback(() => {
    onOpen(row.id);
  }, [onOpen, row.id]);
  const leading = useMemo(() => <WorkspaceTabIcon presentation={presentation} />, [presentation]);
  return (
    <DropdownMenuItem
      onSelect={handleSelect}
      leading={leading}
      testID={`workspace-tab-subagent-${row.id}`}
    >
      {displayLabel}
    </DropdownMenuItem>
  );
}

function TabSubagentsDropdown({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}) {
  const rows = useSubagentsForParent({ serverId, parentAgentId });
  // Block the tab's drag/navigate handlers so pressing the chevron only
  // opens the dropdown.
  const dragBlockers = isWeb
    ? ({
        onPointerDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
        onMouseDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
      } as const)
    : undefined;

  const handleOpenSubagent = useCallback(
    (agentId: string) => {
      navigateToAgent({ serverId, agentId });
    },
    [serverId],
  );

  const handleTriggerPressIn = useCallback((event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  }, []);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.tabSubagentsButton,
      (hovered || pressed || open) && styles.tabSubagentsButtonActive,
    ],
    [],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        {...(dragBlockers as object | undefined)}
        onPressIn={handleTriggerPressIn}
        style={triggerStyle}
        accessibilityLabel={formatHeaderLabel(rows)}
        testID={`workspace-tab-subagents-${parentAgentId}`}
        hitSlop={6}
      >
        {({ hovered, pressed, open }) => (
          <>
            <Text style={styles.tabSubagentsCount} selectable={false}>
              {rows.length}
            </Text>
            <ThemedChevronDown
              size={10}
              uniProps={hovered || pressed || open ? foregroundColorMapping : mutedColorMapping}
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={DROPDOWN_WIDTH} maxHeight={320} scrollable>
        {rows.map((row) => (
          <TabSubagentItem key={row.id} row={row} onOpen={handleOpenSubagent} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GroupColorMenuItems({ onSetColor }: { onSetColor: (color: TabGroupColorId) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {TAB_GROUP_COLOR_IDS.map((colorId) => (
        <GroupColorMenuItem key={colorId} colorId={colorId} onSetColor={onSetColor} t={t} />
      ))}
    </>
  );
}

function GroupColorMenuItem({
  colorId,
  onSetColor,
  t,
}: {
  colorId: TabGroupColorId;
  onSetColor: (color: TabGroupColorId) => void;
  t: (key: string) => string;
}) {
  const handleSelect = useCallback(() => onSetColor(colorId), [colorId, onSetColor]);
  const dotStyle = useMemo(
    () => [styles.groupColorDot, { backgroundColor: TAB_GROUP_COLOR_HEX[colorId] }],
    [colorId],
  );
  return (
    <ContextMenuItem onSelect={handleSelect}>
      <View style={styles.colorMenuRow}>
        <View style={dotStyle} />
        <Text style={styles.colorMenuLabel}>{t(`workspace.tabs.groups.colors.${colorId}`)}</Text>
      </View>
    </ContextMenuItem>
  );
}

/**
 * Solid color control for a tab group: click toggles collapse; right-click
 * renames / recolors. Owns its own width in the tab row (not nested in a tab).
 *
 * Renders a single interactive surface (never a Pressable inside a drag shell
 * or ContextMenuTrigger) so web does not hydrate nested button elements.
 */
function GroupColorSquare({
  color,
  title,
  collapsed,
  onPress,
  onRename,
  onSetColor,
  onUngroup,
  accessibilityLabel,
  testID,
  dragHandleProps,
}: {
  color: string;
  title: string;
  collapsed: boolean;
  onPress: () => void;
  onRename?: () => void;
  onSetColor?: (color: TabGroupColorId) => void;
  onUngroup?: () => void;
  accessibilityLabel: string;
  testID?: string;
  /** Optional dnd-kit handle — applied to the same pressable (no outer button shell). */
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { t } = useTranslation();
  const squareStyle = useMemo(
    () => [groupStyles.groupColorSquare, { backgroundColor: color }],
    [color],
  );

  const handlePress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onPress();
    },
    [onPress],
  );

  const label = (
    <Text style={groupStyles.groupColorSquareLabel} numberOfLines={1} ellipsizeMode="tail">
      {title}
    </Text>
  );

  // One pressable only: collapse/expand + optional drag handle + optional context menu.
  // ContextMenuTrigger is itself a Pressable — do not nest another Pressable inside it.
  const hasMenu = Boolean(onRename || onSetColor || onUngroup);
  if (hasMenu) {
    return (
      <ContextMenu>
        <ContextMenuTrigger
          enabledOnMobile={false}
          onPress={handlePress}
          hitSlop={collapsed ? 0 : 2}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          style={squareStyle}
          {...(dragHandleProps?.attributes as object | undefined)}
          {...(dragHandleProps?.listeners as object | undefined)}
          triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
        >
          {label}
        </ContextMenuTrigger>
        <ContextMenuContent align="start" width={200}>
          {onRename ? (
            <ContextMenuItem onSelect={onRename}>
              {t("workspace.tabs.groups.rename")}
            </ContextMenuItem>
          ) : null}
          {onSetColor ? <GroupColorMenuItems onSetColor={onSetColor} /> : null}
          {onUngroup ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onUngroup}>
                {t("workspace.tabs.groups.ungroup")}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={collapsed ? 0 : 2}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={squareStyle}
      {...(dragHandleProps?.attributes as object | undefined)}
      {...(dragHandleProps?.listeners as object | undefined)}
      // Pressable accepts ref via the same path as ContextMenuTrigger on web.
      ref={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
    >
      {label}
    </Pressable>
  );
}

/** Tab chips accumulate many props and handlers by design. */
// eslint-disable-next-line complexity -- tab chrome + group chrome share one component
function TabChip({
  tab,
  serverId,
  isActive,
  isDragging,
  isFocused,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  isClosingTab,
  presentation,
  tooltipLabel,
  resolvedTab,
  onNavigateTab,
  onCloseTab,
  dragHandleProps,
  groupRole = "none",
  isGroupDropTarget = false,
  onCollapseGroup,
  onRenameGroup,
  onSetGroupColor,
  onUngroup,
}: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  isActive: boolean;
  isDragging: boolean;
  isFocused: boolean;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  isClosingTab: boolean;
  presentation: WorkspaceTabPresentation;
  tooltipLabel: string;
  resolvedTab: WorkspaceDesktopTabActions;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  groupRole?: TabGroupVisualRole;
  isGroupDropTarget?: boolean;
  onCollapseGroup?: () => void;
  onRenameGroup?: () => void;
  onSetGroupColor?: (color: TabGroupColorId) => void;
  onUngroup?: () => void;
}) {
  const { t } = useTranslation();
  const { closeButtonTestId, contextMenuTestId, menuEntries } = resolvedTab;
  const middleClickRef = useMiddleClickClose(
    useCallback(() => void onCloseTab(tab.tabId), [onCloseTab, tab.tabId]),
  );
  const closeButtonDragBlockers = isWeb
    ? ({
        onPointerDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
        onMouseDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
      } as const)
    : undefined;

  // Grouped tabs keep the default chip chrome — no fill/border override.
  // Membership underline is drawn on the outer tabSlot (continuous across gaps).
  const tabChipStyle = useCallback(
    () => [
      styles.tab,
      isActive && styles.tabActiveChip,
      isWeb && isDragging && ({ cursor: "grabbing" } as object),
      isGroupDropTarget && styles.tabGroupDropTarget,
      {
        minWidth: resolvedTabWidth,
        width: resolvedTabWidth,
        maxWidth: resolvedTabWidth,
      },
    ],
    [isActive, isDragging, isGroupDropTarget, resolvedTabWidth],
  );

  const handleNavigateTab = useCallback(() => {
    onNavigateTab(tab.tabId);
  }, [onNavigateTab, tab.tabId]);

  const handleCloseButtonPressIn = useCallback((event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  }, []);

  const handleCloseButtonPress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      void onCloseTab(tab.tabId);
    },
    [onCloseTab, tab.tabId],
  );

  const closeButtonStyle = useCallback(
    ({ hovered: isButtonHovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tabCloseButton,
      styles.tabCloseButtonShown,
      (Boolean(isButtonHovered) || pressed) && styles.tabCloseButtonActive,
    ],
    [],
  );

  const tabAccessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const tabFocusIndicatorStyle = useMemo(
    () => [styles.tabFocusIndicator, !isFocused && styles.tabFocusIndicatorUnfocused],
    [isFocused],
  );
  const tabLabelSkeletonStyle = useMemo(
    () => [styles.tabLabelSkeleton, showCloseButton && styles.tabLabelSkeletonWithCloseButton],
    [showCloseButton],
  );
  const tabLabelStyle = useMemo(
    () => [
      styles.tabLabel,
      isActive && styles.tabLabelActive,
      showCloseButton && styles.tabLabelWithCloseButton,
    ],
    [isActive, showCloseButton],
  );

  return (
    <View ref={middleClickRef}>
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              testID={`workspace-tab-${buildDeterministicWorkspaceTabId(tab.target)}`}
              triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
              enabledOnMobile={false}
              style={tabChipStyle}
              dataSet={WORKSPACE_TAB_DATA_SET}
              onPressIn={handleNavigateTab}
              onPress={handleNavigateTab}
              accessibilityRole="button"
              accessibilityLabel={tooltipLabel}
              accessibilityState={tabAccessibilityState}
              aria-selected={isActive}
            >
              {isActive && <View style={tabFocusIndicatorStyle} />}
              <TabHandleContent
                presentation={presentation}
                isHighlighted={isActive}
                showLabel={showLabel}
                tabLabelSkeletonStyle={tabLabelSkeletonStyle}
                tabLabelStyle={tabLabelStyle}
              />

              {tab.target.kind === "agent" ? (
                <TabSubagentsDropdown serverId={serverId} parentAgentId={tab.target.agentId} />
              ) : null}

              {showCloseButton ? (
                <Pressable
                  {...(closeButtonDragBlockers as object | undefined)}
                  testID={closeButtonTestId}
                  disabled={isClosingTab}
                  onPressIn={handleCloseButtonPressIn}
                  onPress={handleCloseButtonPress}
                  dataSet={WORKSPACE_TAB_CLOSE_DATA_SET}
                  style={isWeb ? WEB_TAB_CLOSE_BUTTON_STYLE : closeButtonStyle}
                >
                  {isWeb ? (
                    <TabCloseGlyph isClosingTab={isClosingTab} active={false} />
                  ) : (
                    ({ hovered: closeHovered, pressed }) => (
                      <TabCloseGlyph
                        isClosingTab={isClosingTab}
                        active={Boolean(closeHovered) || pressed}
                      />
                    )
                  )}
                </Pressable>
              ) : null}
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            {tab.target.kind === "agent" ? (
              <View style={styles.tooltipAgentRow}>
                <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
                <Text style={styles.tooltipAgentId}>{tab.target.agentId.slice(0, 7)}</Text>
              </View>
            ) : (
              <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
            )}
          </TooltipContent>
        </Tooltip>

        <ContextMenuContent align="start" width={DROPDOWN_WIDTH} testID={contextMenuTestId}>
          {groupRole !== "none" ? (
            <>
              {onCollapseGroup ? (
                <ContextMenuItem onSelect={onCollapseGroup}>
                  {t("workspace.tabs.groups.collapse")}
                </ContextMenuItem>
              ) : null}
              {onRenameGroup ? (
                <ContextMenuItem onSelect={onRenameGroup}>
                  {t("workspace.tabs.groups.rename")}
                </ContextMenuItem>
              ) : null}
              {onSetGroupColor ? <GroupColorMenuItems onSetColor={onSetGroupColor} /> : null}
              {onUngroup ? (
                <ContextMenuItem onSelect={onUngroup}>
                  {t("workspace.tabs.groups.ungroup")}
                </ContextMenuItem>
              ) : null}
              <ContextMenuSeparator key="group-sep" />
            </>
          ) : null}
          {menuEntries.map((entry) =>
            entry.kind === "separator" ? (
              <ContextMenuSeparator key={entry.key} />
            ) : (
              <TabContextMenuItem key={entry.key} entry={entry} />
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    </View>
  );
}

function useWheelToHorizontalScroll(
  scrollRef: React.RefObject<ScrollView | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!isWeb || !enabled) {
      return () => {};
    }
    const rawRef: unknown = scrollRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const node = rawRef;
    const handleWheel = (event: WheelEvent) => {
      const result = resolveWorkspaceTabWheelScroll({
        scrollLeft: node.scrollLeft,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      node.scrollLeft = result.nextScrollLeft;
      if (result.shouldPreventDefault) {
        event.preventDefault();
      }
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [scrollRef, enabled]);
}

export function WorkspaceDesktopTabsRow({
  paneId,
  isFocused = false,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  onNavigateTab,
  onCloseTab,
  onToggleGroupCollapsed,
  onRenameGroup,
  onSetGroupColor,
  onUngroup,
  groupDropTargetTabId = null,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab = false,
  disableCreateTerminal = false,
  isWaitingOnTerminalReadiness = false,
  onReorderTabs,
  onSplitRight,
  onSplitDown,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = true,
  focusModeEnabled,
  onExitFocusMode,
}: WorkspaceDesktopTabsRowProps) {
  useEffect(() => installWorkspaceDesktopTabsWebStyles(), []);
  const { t } = useTranslation();
  const router = useRouter();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const focusModeKeys = useShortcutKeys("toggle-focus");
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const [tabsContainerWidth, setTabsContainerWidth] = useState<number>(0);
  const [tabsActionsWidth, setTabsActionsWidth] = useState<number>(0);
  const [inlineAddButtonWidth, setInlineAddButtonWidth] = useState<number>(0);
  const tabsScrollRef = useRef<ScrollView | null>(null);
  const [exitFocusModeWidth, setExitFocusModeWidth] = useState<number>(0);

  const handleTabsContainerLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsContainerWidth, event);
  }, []);

  const handleTabsActionsLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsActionsWidth, event);
  }, []);

  const handleInlineAddButtonLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setInlineAddButtonWidth, event);
  }, []);

  const handleExitFocusModeLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setExitFocusModeWidth, event);
  }, []);

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      actionsReservedWidth: Math.max(
        0,
        tabsActionsWidth +
          (inlineAddButtonWidth || DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH) +
          (focusModeEnabled ? exitFocusModeWidth : 0),
      ),
      rowPaddingHorizontal: 0,
      tabGap: 0,
      maxTabWidth: 200,
      tabIconWidth: 14,
      tabHorizontalPadding: 12,
      estimatedCharWidth: 7,
      closeButtonWidth: 22,
    }),
    [exitFocusModeWidth, focusModeEnabled, inlineAddButtonWidth, tabsActionsWidth],
  );

  const fallbackTabLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
    }),
    [t],
  );
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const tabLabelLengths = useMemo(
    () =>
      tabs.map((item) => {
        if (item.kind === "collapsed-group" || item.kind === "group-header") {
          return item.group.title.length || 8;
        }
        const label = getFallbackTabLabel(item.tab, fallbackTabLabels);
        return label.length;
      }),
    [fallbackTabLabels, tabs],
  );

  const { layout } = useWorkspaceTabLayout({
    tabLabelLengths,
    viewportWidthOverride: tabsContainerWidth > 0 ? tabsContainerWidth : null,
    metrics: layoutMetrics,
  });

  useWheelToHorizontalScroll(tabsScrollRef, layout.requiresHorizontalScrollFallback);

  const handleDragEnd = useCallback(
    (nextItems: WorkspaceDesktopTabRowItem[]) => {
      // Expand collapsed groups back into their member order for the flat
      // pane.tabIds list the layout store expects. Group headers are chrome
      // only — they do not contribute tab ids.
      const nextTabs: WorkspaceTabDescriptor[] = [];
      for (const item of nextItems) {
        if (item.kind === "group-header") {
          continue;
        }
        if (item.kind === "collapsed-group") {
          nextTabs.push(...item.memberTabs);
        } else {
          nextTabs.push(item.tab);
        }
      }
      onReorderTabs(nextTabs);
    },
    [onReorderTabs],
  );

  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (item: WorkspaceDesktopTabRowItem) => {
      if (item.kind === "collapsed-group") {
        return {
          kind: "workspace-tab" as const,
          paneId,
          // Drag the active (or first) member so drop/group logic still works.
          tabId: item.activeMember.tabId,
        };
      }
      if (item.kind === "group-header") {
        // Header is not a drag source (no handle); keep a stable shape for DnD.
        return {
          kind: "workspace-tab" as const,
          paneId,
          tabId: item.group.id,
        };
      }
      return {
        kind: "workspace-tab" as const,
        paneId,
        tabId: item.tab.tabId,
      };
    };
  }, [paneId]);

  const [renameGroupState, setRenameGroupState] = useState<{
    groupId: string;
    title: string;
  } | null>(null);

  const handleCreateAgentTab = useCallback(() => {
    onCreateDraftTab({ paneId });
  }, [onCreateDraftTab, paneId]);

  const handleCreateTerminal = useCallback(() => {
    onCreateTerminalTab({ paneId });
  }, [onCreateTerminalTab, paneId]);

  const handleCreateTerminalWithProfile = useCallback(
    (profile: TerminalProfileInput) => {
      onCreateTerminalTab({ paneId, profile });
    },
    [onCreateTerminalTab, paneId],
  );

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const handleCreateBrowser = useCallback(() => {
    onCreateBrowserTab({ paneId });
  }, [onCreateBrowserTab, paneId]);

  const openTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const handleCreatePortForwards = useCallback(() => {
    const key = buildWorkspaceTabPersistenceKey({
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
    });
    if (!key) {
      return;
    }
    openTabFocused(key, { kind: "port-forwards" });
  }, [normalizedServerId, normalizedWorkspaceId, openTabFocused]);

  const terminalDisabled = disableCreateTerminal || isWaitingOnTerminalReadiness;

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => {
      const shouldShowCloseButton = layout.closeButtonPolicy === "all";
      const layoutItem = layout.items[index] ?? null;
      const resolvedTabWidth = layoutItem?.width ?? 150;
      const showLabel = layoutItem?.showLabel ?? true;
      const showDropIndicatorBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === tabs.length &&
        index === tabs.length - 1;

      if (item.kind === "collapsed-group") {
        return (
          <CollapsedGroupChip
            item={item}
            isFocused={isFocused}
            isDragging={isActive}
            resolvedTabWidth={resolvedTabWidth}
            showDropIndicatorBefore={showDropIndicatorBefore}
            showDropIndicatorAfter={showDropIndicatorAfter}
            dragHandleProps={dragHandleProps}
            onToggleGroupCollapsed={onToggleGroupCollapsed}
            onNavigateTab={onNavigateTab}
            onRequestRenameGroup={setRenameGroupState}
            onSetGroupColor={onSetGroupColor}
            onUngroup={onUngroup}
          />
        );
      }

      if (item.kind === "group-header") {
        return (
          <ExpandedGroupHeaderChip
            item={item}
            showDropIndicatorBefore={showDropIndicatorBefore}
            showDropIndicatorAfter={showDropIndicatorAfter}
            onToggleGroupCollapsed={onToggleGroupCollapsed}
            onRequestRenameGroup={setRenameGroupState}
            onSetGroupColor={onSetGroupColor}
            onUngroup={onUngroup}
          />
        );
      }

      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={index}
          tabCount={tabs.length}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          resolvedTabWidth={resolvedTabWidth}
          showLabel={showLabel}
          showCloseButton={shouldShowCloseButton}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          labels={tabMenuLabels}
          dragHandleProps={dragHandleProps}
          showDropIndicatorBefore={showDropIndicatorBefore}
          showDropIndicatorAfter={showDropIndicatorAfter}
          isGroupDropTarget={groupDropTargetTabId === item.tab.tabId}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onRequestRenameGroup={setRenameGroupState}
          onSetGroupColor={onSetGroupColor}
          onUngroup={onUngroup}
          defaultGroupTitle={t("workspace.tabs.groups.defaultTitle")}
        />
      );
    },
    [
      activeDragTabId,
      groupDropTargetTabId,
      isFocused,
      layout.closeButtonPolicy,
      layout.items,
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      onSetGroupColor,
      onToggleGroupCollapsed,
      onUngroup,
      setHoveredCloseTabKey,
      t,
      tabMenuLabels,
      tabDropPreviewIndex,
      tabs.length,
    ],
  );

  const tabsScrollStyle = useMemo(
    () => [
      styles.tabsScroll,
      layout.requiresHorizontalScrollFallback
        ? styles.tabsScrollOverflow
        : styles.tabsScrollFitContent,
    ],
    [layout.requiresHorizontalScrollFallback],
  );

  const inlineAddTabButton = (
    <WorkspaceInlineAddTabButton
      shortcutKeys={newTabKeys}
      onCreateAgentTab={handleCreateAgentTab}
      onLayout={handleInlineAddButtonLayout}
    />
  );
  const isTabsOverflowing = layout.requiresHorizontalScrollFallback;

  const row = (
    <View
      style={styles.tabsContainer}
      testID="workspace-tabs-row"
      onLayout={handleTabsContainerLayout}
    >
      {focusModeEnabled ? (
        <View style={styles.exitFocusModeSlot} onLayout={handleExitFocusModeLayout}>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger
              testID="workspace-exit-focus-mode"
              onPress={onExitFocusMode}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.exitFocusMode")}
              dataSet={WORKSPACE_TAB_ACTION_DATA_SET}
              style={isWeb ? styles.inlineAddActionButton : inlineAddActionButtonStyle}
            >
              <ThemedX size={14} uniProps={mutedColorMapping} />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <View style={styles.newTabTooltipRow}>
                <Text style={styles.newTabTooltipText}>
                  {t("workspace.tabs.actions.exitFocusMode")}
                </Text>
                {focusModeKeys ? (
                  <Shortcut chord={focusModeKeys} style={styles.newTabTooltipShortcut} />
                ) : null}
              </View>
            </TooltipContent>
          </Tooltip>
        </View>
      ) : null}
      <ScrollView
        ref={tabsScrollRef}
        horizontal
        scrollEnabled={layout.requiresHorizontalScrollFallback}
        testID="workspace-tabs-scroll"
        style={tabsScrollStyle}
        contentContainerStyle={styles.tabsContent}
        showsHorizontalScrollIndicator={false}
      >
        <SortableInlineList
          data={tabs}
          keyExtractor={tabKeyExtractor}
          useDragHandle
          disabled={!externalDndContext && tabs.length < 2}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragTabId}
          getItemData={getTabDragData}
          renderItem={renderTab}
        />
        {isTabsOverflowing ? null : inlineAddTabButton}
      </ScrollView>
      <View style={styles.tabsActions} onLayout={handleTabsActionsLayout}>
        {isTabsOverflowing ? inlineAddTabButton : null}
        <WorkspaceTabRowExtras
          onCreateAgentTab={handleCreateAgentTab}
          onCreateTerminal={handleCreateTerminal}
          onCreateBrowser={handleCreateBrowser}
          onCreateTerminalWithProfile={handleCreateTerminalWithProfile}
          onEditProfiles={handleEditProfiles}
          onCreatePortForwards={handleCreatePortForwards}
          normalizedServerId={normalizedServerId}
          showCreateBrowserTab={showCreateBrowserTab}
          terminalDisabled={terminalDisabled}
        />
        {showPaneSplitActions ? (
          <>
            <SplitActionButton
              icon="split-right"
              onPress={onSplitRight}
              label={t("workspace.tabs.actions.splitRight")}
              shortcutKeys={splitRightKeys}
            />
            <SplitActionButton
              icon="split-down"
              onPress={onSplitDown}
              label={t("workspace.tabs.actions.splitDown")}
              shortcutKeys={splitDownKeys}
            />
          </>
        ) : null}
      </View>
    </View>
  );

  const handleCloseRenameGroup = useCallback(() => {
    setRenameGroupState(null);
  }, []);
  const handleSubmitRenameGroup = useCallback(
    (value: string) => {
      if (renameGroupState) {
        onRenameGroup?.(renameGroupState.groupId, value);
      }
      setRenameGroupState(null);
    },
    [onRenameGroup, renameGroupState],
  );

  return (
    <RenderProfile id="WorkspaceDesktopTabsRow">
      <>
        {row}
        <AdaptiveRenameModal
          visible={renameGroupState !== null}
          title={t("workspace.tabs.groups.renameTitle")}
          initialValue={renameGroupState?.title ?? ""}
          submitLabel={t("workspace.tabs.menu.rename")}
          onClose={handleCloseRenameGroup}
          onSubmit={handleSubmitRenameGroup}
          testID="workspace-tab-group-rename"
        />
      </>
    </RenderProfile>
  );
}

function CollapsedGroupChip({
  item,
  isFocused,
  isDragging,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  dragHandleProps,
  onToggleGroupCollapsed,
  onNavigateTab,
  onRequestRenameGroup,
  onSetGroupColor,
  onUngroup,
}: {
  item: Extract<WorkspaceDesktopTabRowItem, { kind: "collapsed-group" }>;
  isFocused: boolean;
  isDragging: boolean;
  resolvedTabWidth: number;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  onToggleGroupCollapsed?: (groupId: string, collapsed: boolean) => void;
  onNavigateTab: (tabId: string) => void;
  onRequestRenameGroup: (state: { groupId: string; title: string }) => void;
  onSetGroupColor?: (groupId: string, color: string) => void;
  onUngroup?: (groupId: string) => void;
}) {
  const { t } = useTranslation();
  const color = TAB_GROUP_COLOR_HEX[item.group.color] ?? TAB_GROUP_COLOR_HEX.blue;
  const label = item.group.title || t("workspace.tabs.groups.defaultTitle");
  const groupId = item.group.id;

  const handleExpand = useCallback(() => {
    onToggleGroupCollapsed?.(groupId, false);
    // Surface the active member once the group opens.
    onNavigateTab(item.activeMember.tabId);
  }, [groupId, item.activeMember.tabId, onNavigateTab, onToggleGroupCollapsed]);
  const handleRename = useCallback(() => {
    onRequestRenameGroup({ groupId, title: item.group.title });
  }, [groupId, item.group.title, onRequestRenameGroup]);
  const handleSetColor = useCallback(
    (colorId: TabGroupColorId) => {
      onSetGroupColor?.(groupId, colorId);
    },
    [groupId, onSetGroupColor],
  );
  const handleUngroup = useCallback(() => {
    onUngroup?.(groupId);
  }, [groupId, onUngroup]);

  const shellStyle = useMemo(
    () => [groupStyles.groupHeaderShell, isWeb && isDragging && ({ cursor: "grabbing" } as object)],
    [isDragging],
  );

  return (
    <View style={styles.tabSlot}>
      {showDropIndicatorBefore ? <View style={TAB_DROP_INDICATOR_BEFORE_STYLE} /> : null}
      {/* Layout shell only — drag + expand + context menu live on GroupColorSquare
          (single button). Spreading dnd attributes onto a View turns it into a
          second <button> on web and nests the square Pressable inside it. */}
      <View style={shellStyle} testID={`workspace-tab-group-collapsed-${groupId}`}>
        <GroupColorSquare
          color={color}
          title={label}
          collapsed
          onPress={handleExpand}
          onRename={handleRename}
          onSetColor={handleSetColor}
          onUngroup={handleUngroup}
          accessibilityLabel={t("workspace.tabs.groups.expand")}
          testID={`workspace-tab-group-square-collapsed-${groupId}`}
          dragHandleProps={dragHandleProps}
        />
      </View>
      {showDropIndicatorAfter ? <View style={TAB_DROP_INDICATOR_AFTER_STYLE} /> : null}
      {isFocused && item.isActive ? <View style={styles.tabFocusIndicator} /> : null}
    </View>
  );
}

/**
 * Expanded-group color chip as its own tab-row item (independent width).
 * Not draggable — collapse/rename/color only. Continuous underline starts here.
 */
function ExpandedGroupHeaderChip({
  item,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  onToggleGroupCollapsed,
  onRequestRenameGroup,
  onSetGroupColor,
  onUngroup,
}: {
  item: Extract<WorkspaceDesktopTabRowItem, { kind: "group-header" }>;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  onToggleGroupCollapsed?: (groupId: string, collapsed: boolean) => void;
  onRequestRenameGroup: (state: { groupId: string; title: string }) => void;
  onSetGroupColor?: (groupId: string, color: string) => void;
  onUngroup?: (groupId: string) => void;
}) {
  const { t } = useTranslation();
  const color = TAB_GROUP_COLOR_HEX[item.group.color] ?? TAB_GROUP_COLOR_HEX.blue;
  const label = item.group.title || t("workspace.tabs.groups.defaultTitle");
  const groupId = item.group.id;

  const handleCollapse = useCallback(() => {
    onToggleGroupCollapsed?.(groupId, true);
  }, [groupId, onToggleGroupCollapsed]);
  const handleRename = useCallback(() => {
    onRequestRenameGroup({ groupId, title: item.group.title });
  }, [groupId, item.group.title, onRequestRenameGroup]);
  const handleSetColor = useCallback(
    (colorId: TabGroupColorId) => {
      onSetGroupColor?.(groupId, colorId);
    },
    [groupId, onSetGroupColor],
  );
  const handleUngroup = useCallback(() => {
    onUngroup?.(groupId);
  }, [groupId, onUngroup]);

  return (
    <View style={styles.tabSlot}>
      {showDropIndicatorBefore ? <View style={TAB_DROP_INDICATOR_BEFORE_STYLE} /> : null}
      <View style={groupStyles.groupHeaderColumn} testID={`workspace-tab-group-header-${groupId}`}>
        <View style={groupStyles.groupHeaderShell}>
          <GroupColorSquare
            color={color}
            title={label}
            collapsed={false}
            onPress={handleCollapse}
            onRename={handleRename}
            onSetColor={handleSetColor}
            onUngroup={handleUngroup}
            accessibilityLabel={t("workspace.tabs.groups.collapse")}
            testID={`workspace-tab-group-square-${groupId}`}
          />
        </View>
        {/* Absolute — does not consume row height; hangs below the chip with a gap. */}
        <GroupMembershipLine color={color} role="header" />
      </View>
      {showDropIndicatorAfter ? <View style={TAB_DROP_INDICATOR_AFTER_STYLE} /> : null}
    </View>
  );
}

function ResolvedDesktopTabChip({
  item,
  isFocused,
  isDragging,
  index,
  tabCount,
  normalizedServerId,
  normalizedWorkspaceId,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  onNavigateTab,
  onCloseTab,
  labels,
  dragHandleProps,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  isGroupDropTarget,
  onToggleGroupCollapsed,
  onRequestRenameGroup,
  onSetGroupColor,
  onUngroup,
  defaultGroupTitle,
}: {
  item: Extract<WorkspaceDesktopTabRowItem, { kind: "tab" }>;
  isFocused: boolean;
  isDragging: boolean;
  index: number;
  tabCount: number;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  labels: WorkspaceTabMenuLabels;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  isGroupDropTarget: boolean;
  onToggleGroupCollapsed?: (groupId: string, collapsed: boolean) => void;
  onRequestRenameGroup: (state: { groupId: string; title: string }) => void;
  onSetGroupColor?: (groupId: string, color: string) => void;
  onUngroup?: (groupId: string) => void;
  defaultGroupTitle: string;
}) {
  const { t } = useTranslation();
  const groupId = item.groupId ?? null;
  const handleCollapseGroup = useCallback(() => {
    if (groupId) {
      onToggleGroupCollapsed?.(groupId, true);
    }
  }, [groupId, onToggleGroupCollapsed]);
  const handleRenameGroup = useCallback(() => {
    if (groupId) {
      onRequestRenameGroup({
        groupId,
        title: item.group?.title ?? defaultGroupTitle,
      });
    }
  }, [defaultGroupTitle, groupId, item.group?.title, onRequestRenameGroup]);
  const handleSetGroupColor = useCallback(
    (color: TabGroupColorId) => {
      if (groupId) {
        onSetGroupColor?.(groupId, color);
      }
    },
    [groupId, onSetGroupColor],
  );
  const handleUngroup = useCallback(() => {
    if (groupId) {
      onUngroup?.(groupId);
    }
  }, [groupId, onUngroup]);

  const resolvedTab = useMemo(
    () =>
      buildWorkspaceDesktopTabActions({
        tab: item.tab,
        index,
        tabCount,
        onCopyResumeCommand,
        onCopyAgentId,
        onCopyFilePath,
        onReloadAgent,
        onRenameTab,
        onCloseTab,
        onCloseTabsToLeft,
        onCloseTabsToRight,
        onCloseOtherTabs,
        labels,
      }),
    [
      index,
      item.tab,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      labels,
      onReloadAgent,
      onRenameTab,
      tabCount,
    ],
  );

  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => {
        const tooltipLabel =
          presentation.titleState === "loading"
            ? t("workspace.tabs.loadingAgentTitle")
            : presentation.label;

        const groupRole = item.groupRole ?? "none";
        const groupColor = item.group ? TAB_GROUP_COLOR_HEX[item.group.color] : null;

        return (
          <View style={styles.tabSlot}>
            {showDropIndicatorBefore ? <View style={TAB_DROP_INDICATOR_BEFORE_STYLE} /> : null}
            <View style={groupRole !== "none" ? groupStyles.groupMemberColumn : undefined}>
              <TabChip
                tab={item.tab}
                serverId={normalizedServerId}
                isActive={item.isActive}
                isDragging={isDragging}
                isFocused={isFocused}
                resolvedTabWidth={resolvedTabWidth}
                showLabel={showLabel}
                showCloseButton={showCloseButton}
                isCloseHovered={item.isCloseHovered}
                isClosingTab={item.isClosingTab}
                presentation={presentation}
                tooltipLabel={tooltipLabel}
                resolvedTab={resolvedTab}
                setHoveredCloseTabKey={setHoveredCloseTabKey}
                onNavigateTab={onNavigateTab}
                onCloseTab={onCloseTab}
                dragHandleProps={dragHandleProps}
                groupRole={groupRole}
                isGroupDropTarget={isGroupDropTarget}
                onCollapseGroup={groupId ? handleCollapseGroup : undefined}
                onRenameGroup={groupId ? handleRenameGroup : undefined}
                onSetGroupColor={groupId ? handleSetGroupColor : undefined}
                onUngroup={groupId ? handleUngroup : undefined}
              />
              {groupColor && groupRole !== "none" ? (
                <GroupMembershipLine color={groupColor} role={groupRole} />
              ) : null}
            </View>
            {showDropIndicatorAfter ? <View style={TAB_DROP_INDICATOR_AFTER_STYLE} /> : null}
          </View>
        );
      }}
    </WorkspaceTabPresentationResolver>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabsContainer: {
    minWidth: 0,
    // New theme: a taller row (28px chip + 2×8) so each chip's top/bottom inset
    // matches its left/right inset (tabsContent paddingHorizontal = spacing[2] = 8),
    // keeping the first chip symmetric to the card's top-left corner. Classic: 36.
    height: theme.shell.floating ? 44 : WORKSPACE_SECONDARY_HEADER_HEIGHT,
    // New theme drops the bottom divider — the tab row blends into the card.
    borderBottomWidth: theme.shell.floating ? 0 : 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
  },
  tabsScroll: {
    minWidth: 0,
  },
  tabsScrollFitContent: {
    flex: 1,
  },
  tabsScrollOverflow: {
    flex: 1,
  },
  tabsContent: {
    flexDirection: "row",
    // New theme: center the inset chips and space them apart so each reads as an
    // independent rounded rectangle. Classic: full-height tabs, no gap.
    alignItems: theme.shell.floating ? "center" : "stretch",
    gap: theme.shell.floating ? theme.spacing[1] : 0,
    paddingHorizontal: theme.shell.floating ? theme.spacing[2] : 0,
  },
  tabsActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  exitFocusModeSlot: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  inlineAddButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
  },
  tab: {
    // Classic: fixed to the row height (not padding-derived) so the chip fills the
    // tab bar exactly and the active indicator at top:0 touches the header divider
    // above with no gap. New theme: a shorter, self-contained #fafafa rounded chip
    // (centered in the row by tabsContent), no inter-tab divider.
    height: theme.shell.floating ? 28 : WORKSPACE_SECONDARY_HEADER_HEIGHT,
    paddingHorizontal: theme.spacing[3],
    borderRightWidth: theme.shell.floating ? 0 : 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.shell.floating ? theme.colors.surface1 : "transparent",
    borderRadius: theme.shell.floating ? theme.borderRadius.lg : 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
    // Anchor for absolute group bottom line / active indicator.
    position: "relative",
    overflow: "hidden",
  },
  // New theme: active chip gets a slightly stronger fill (the top accent bar is
  // hidden). No-op in classic, where the accent bar marks the active tab.
  tabActiveChip: {
    backgroundColor: theme.shell.floating ? theme.colors.surface2 : "transparent",
  },
  tabSlot: {
    position: "relative",
    overflow: "visible",
  },
  tabGroupDropTarget: {
    outlineWidth: 2,
    outlineColor: theme.colors.accent,
    outlineStyle: "solid",
    zIndex: 2,
  },
  groupColorDot: {
    width: 10,
    height: 10,
    borderRadius: theme.borderRadius.full,
  },
  colorMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  colorMenuLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tabHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
    userSelect: "none",
  },
  tabIcon: {
    flexShrink: 0,
  },
  tabFocusIndicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // New theme marks the active tab via its fill instead of the top accent bar.
    height: theme.shell.floating ? 0 : 2,
    backgroundColor: theme.colors.accent,
  },
  tabFocusIndicatorUnfocused: {
    backgroundColor: theme.colors.borderAccent,
  },
  tabDropIndicator: {
    position: "absolute",
    top: theme.spacing[2],
    bottom: theme.spacing[2],
    width: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  tabDropIndicatorBefore: {
    left: -3,
  },
  tabDropIndicatorAfter: {
    right: -3,
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabLabelSkeleton: {
    width: 96,
    maxWidth: "100%",
    flexShrink: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.9,
  },
  tabLabelSkeletonWithCloseButton: {
    width: LOADING_TAB_LABEL_SKELETON_WIDTH,
  },
  tabLabelWithCloseButton: {
    paddingRight: 0,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabCloseButton: {
    width: 18,
    height: 18,
    marginLeft: 0,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabSubagentsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
  },
  tabSubagentsButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  tabSubagentsCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tabCloseButtonShown: {
    opacity: 1,
  },
  tabCloseButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  newTabActionButton: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    // New theme: a visible #fafafa rounded-square button (hover still deepens it).
    backgroundColor: theme.shell.floating ? theme.colors.surface1 : "transparent",
  },
  inlineAddActionButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.shell.floating ? theme.colors.surface1 : "transparent",
  },
  newTabActionButtonDisabled: {
    opacity: 0.5,
  },
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  newTabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  newTabTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  newTabTooltipShortcut: {},
  tooltipAgentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipAgentId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  terminalProfileIconWrapper: {
    width: 14,
    height: 14,
  },
}));

/** Group chrome styles (separate sheet so main tab styles stay under complexity cap). */
const groupStyles = StyleSheet.create((theme) => ({
  // Match tab chip height + radius (floating 28 / lg; classic full header / square).
  groupColorSquare: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
    minWidth: theme.shell.floating ? 28 : 22,
    maxWidth: 140,
    height: theme.shell.floating ? 28 : WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderRadius: theme.shell.floating ? theme.borderRadius.lg : 0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 0,
  },
  groupColorSquareLabel: {
    color: "#ffffff",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
    lineHeight: theme.fontSize.xs + 2,
    includeFontPadding: false,
  },
  // Absolute bar: does not flex-grow the chip. Lives in the column's reserved
  // paddingBottom so ScrollView cannot clip it (top:100% painted outside the
  // box and disappeared). Gap from the chip face = paddingBottom - height.
  groupBottomLine: {
    position: "absolute",
    bottom: theme.shell.floating ? 0 : 2,
    height: 2,
    borderRadius: theme.borderRadius.full,
    pointerEvents: "none",
    zIndex: 1,
  },
  groupBottomLineHeader: {
    left: 0,
    right: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
  },
  groupBottomLineStart: {
    left: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
    right: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
  },
  groupBottomLineMiddle: {
    left: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
    right: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
  },
  groupBottomLineEnd: {
    left: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
    right: 0,
  },
  groupBottomLineOnly: {
    left: theme.shell.floating ? -theme.spacing[1] / 2 : 0,
    right: 0,
  },
  // paddingBottom reserves 3px gap + 2px bar under the 28px chip (still fits in
  // the 44px floating row when centered). Classic: no extra pad — bar is inset.
  groupHeaderColumn: {
    position: "relative",
    overflow: "visible",
    paddingBottom: theme.shell.floating ? 5 : 0,
  },
  groupMemberColumn: {
    position: "relative",
    overflow: "visible",
    paddingBottom: theme.shell.floating ? 5 : 0,
  },
  // Same outer height as a tab chip so the color card lines up in the row.
  groupHeaderShell: {
    height: theme.shell.floating ? 28 : WORKSPACE_SECONDARY_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  },
}));

const TAB_DROP_INDICATOR_BEFORE_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorBefore];
const TAB_DROP_INDICATOR_AFTER_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorAfter];
