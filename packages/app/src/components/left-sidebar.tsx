import { router, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  FolderPlus,
  History,
  Home,
  Plus,
  Search,
  Server,
  Settings,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/sidebar-display-preferences-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useSidebarAnimation } from "@/contexts/sidebar-animation-context";
import { useToast } from "@/contexts/toast-context";
import { pickDirectory } from "@/desktop/pick-directory";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useOpenProject } from "@/hooks/use-open-project";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useSidebarShortcutModel } from "@/hooks/use-sidebar-shortcut-model";
import {
  type SidebarProjectEntry,
  type SidebarStatusWorkspacePlacement,
  useSidebarWorkspacesList,
} from "@/hooks/use-sidebar-workspaces-list";
import { useStatusModeWorkspacePlacements } from "@/hooks/use-status-mode-workspaces";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHosts } from "@/runtime/host-runtime";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  usePanelStore,
} from "@/stores/panel-store";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { canCloseLeftSidebarGesture } from "@/utils/sidebar-animation-state";
import { isElectronRuntime } from "@/desktop/host";
import {
  buildOpenProjectRoute,
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildSettingsAddHostRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useAppSettings } from "@/hooks/use-settings";
import { SidebarSessionsToolbar } from "@/components/sidebar/sidebar-sessions-toolbar";
import { SidebarSessionsList } from "@/components/sidebar/sidebar-sessions-list";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

const MIN_CHAT_WIDTH = 400;

type SidebarShortcutModel = ReturnType<typeof useSidebarShortcutModel>;
type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface LeftSidebarProps {
  selectedAgentId?: string;
}

interface SidebarSharedProps {
  theme: SidebarTheme;
  statusWorkspacePlacements: SidebarStatusWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByKey: Map<string, string>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  activeServerId: string | null;
  /** Fork "new theme": render the flat recency sessions layout instead of the grouped list. */
  isNewThemeSidebar: boolean;
  collapsedProjectKeys: SidebarShortcutModel["collapsedProjectKeys"];
  shortcutIndexByWorkspaceKey: SidebarShortcutModel["shortcutIndexByWorkspaceKey"];
  toggleProjectCollapsed: SidebarShortcutModel["toggleProjectCollapsed"];
  handleRefresh: () => void;
  handleNewWorkspaceNavigate: () => void;
  /** New-theme multi-host list: start a new conversation on a specific host. */
  handleNewWorkspaceForHost: (serverId: string) => void;
  handleOpenProject: () => void;
  /** New-theme toolbar: pick a folder → open it in the New conversation flow. */
  handleOpenProjectFolder: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  newWorkspaceKeys: ShortcutKey[][] | null;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  openProject: string;
  newWorkspace: string;
  newConversation: string;
  home: string;
  settings: string;
  switchHost: string;
  searchHosts: string;
  sessions: string;
  history: string;
  schedules: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  isOpen: boolean;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
  handleSchedulesNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  isOpen: boolean;
  handleViewMore: () => void;
  handleSchedulesNavigate: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  selectedAgentId: _selectedAgentId,
}: LeftSidebarProps) {
  void _selectedAgentId;

  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  // Fork "new theme" swaps the project-grouped list for a flat recency sessions
  // list + top toolbar. Read the device-local setting that drives the theme so
  // the layout branch tracks it reactively (see docs/new-theme.md).
  const isNewThemeSidebar = settings.newThemeEnabled;
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const pathname = usePathname();
  const hosts = useHosts();
  const activeServerId = useMemo(
    () => parseServerIdFromPathname(pathname) ?? hosts[0]?.serverId ?? null,
    [hosts, pathname],
  );

  const {
    workspacePlacements,
    projects,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
  } = useSidebarWorkspacesList({
    enabled: isCompactLayout || isOpen,
  });
  const statusWorkspacePlacements = useStatusModeWorkspacePlacements({
    placements: workspacePlacements,
  });
  const { collapsedProjectKeys, shortcutIndexByWorkspaceKey, toggleProjectCollapsed } =
    useSidebarShortcutModel({ projects });

  const groupMode = useSidebarViewStore((state) => state.groupMode);

  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
    // Also refresh the per-workspace session history rows.
    if (activeServerId) {
      void queryClient.invalidateQueries({ queryKey: agentHistoryQueryKey(activeServerId) });
    }
  }, [activeServerId, queryClient, refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenProjectPicker();
  const openProject = useOpenProject(activeServerId);
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(activeServerId ?? "");

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  // New theme: the flat sidebar shows sessions, not projects, so the classic
  // "add an empty project" outcome is invisible. Instead, picking a folder
  // registers it as a project (so it lands in the Choose project list) and then
  // deep-links into the New workspace screen with that project preselected —
  // closing the loop. Web has no native picker, so go straight to the screen and
  // pick a project there.
  const openProjectFolder = useCallback(async () => {
    if (!activeServerId) return;
    if (!isLocalDaemon) {
      router.navigate(buildNewWorkspaceRoute({ serverId: activeServerId }));
      return;
    }
    try {
      const path = await pickDirectory();
      if (!path) return;
      const result = await openProject(path);
      if (!result.ok) {
        toast.error(result.error ?? t("sidebar.project.toasts.hostDisconnected"));
        return;
      }
      router.navigate(
        buildNewWorkspaceRoute({
          serverId: activeServerId,
          sourceDirectory: result.projectRootPath,
          projectId: result.projectKey,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [activeServerId, isLocalDaemon, openProject, toast, t]);

  const handleOpenProjectFolderMobile = useCallback(() => {
    showMobileAgent();
    void openProjectFolder();
  }, [showMobileAgent, openProjectFolder]);

  const handleOpenProjectFolderDesktop = useCallback(() => {
    void openProjectFolder();
  }, [openProjectFolder]);

  const handleNewWorkspaceNavigate = useCallback(() => {
    router.push(buildNewWorkspaceRoute());
  }, []);

  // Per-host "new chat" for the multi-host sidebar list. Navigating to the
  // host's new-workspace route also makes it the active host (active host is
  // route-derived), so subsequent toolbar actions target the host the user
  // just started a conversation on.
  const handleNewWorkspaceForHost = useCallback((serverId: string) => {
    router.navigate(buildNewWorkspaceRoute({ serverId }));
  }, []);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      router.push(buildSettingsHostSectionRoute(serverId, "connections"));
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    router.push(buildSettingsHostSectionRoute(serverId, "connections"));
  }, []);

  const handleHomeMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildOpenProjectRoute());
  }, [showMobileAgent]);

  const handleHomeDesktop = useCallback(() => {
    router.push(buildOpenProjectRoute());
  }, []);

  const handleViewMoreNavigate = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const handleSchedulesNavigate = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const newWorkspaceKeys = useShortcutKeys("new-workspace");
  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      openProject: t("sidebar.actions.openProject"),
      newWorkspace: t("sidebar.actions.newWorkspace"),
      newConversation: t("sidebar.sessionsList.newConversation"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      switchHost: t("sidebar.host.switchTitle"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      sessions: t("sidebar.sections.sessions"),
      history: t("sidebar.sessionsList.history"),
      schedules: t("sidebar.sections.schedules"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    statusWorkspacePlacements,
    projects,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    activeServerId,
    isNewThemeSidebar,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    handleNewWorkspaceForHost,
    labels,
    newWorkspaceKeys,
  };

  if (isCompactLayout) {
    return (
      <MobileSidebar
        {...sharedProps}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        isOpen={isOpen}
        closeSidebar={showMobileAgent}
        handleNewWorkspaceNavigate={handleNewWorkspaceNavigate}
        handleOpenProject={handleOpenProjectMobile}
        handleOpenProjectFolder={handleOpenProjectFolderMobile}
        handleHome={handleHomeMobile}
        handleSettings={handleSettingsMobile}
        handleAddHost={handleAddHostMobile}
        handleOpenHostSettings={handleOpenHostSettingsMobile}
        handleViewMoreNavigate={handleViewMoreNavigate}
        handleSchedulesNavigate={handleSchedulesNavigate}
      />
    );
  }

  return (
    <DesktopSidebar
      {...sharedProps}
      insetsTop={insets.top}
      isOpen={isOpen}
      handleNewWorkspaceNavigate={handleNewWorkspaceNavigate}
      handleOpenProject={handleOpenProjectDesktop}
      handleOpenProjectFolder={handleOpenProjectFolderDesktop}
      handleHome={handleHomeDesktop}
      handleSettings={handleSettingsDesktop}
      handleAddHost={handleAddHostDesktop}
      handleOpenHostSettings={handleOpenHostSettingsDesktop}
      handleViewMore={handleViewMoreNavigate}
      handleSchedulesNavigate={handleSchedulesNavigate}
    />
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function sidebarHostLocalMarkerTestID(serverId: string): string {
  return `sidebar-host-local-marker-${serverId}`;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  accessibilityLabel,
  icon: Icon,
  iconSize,
  theme,
}: {
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  icon: typeof FolderPlus;
  iconSize?: number;
  theme: SidebarTheme;
  buttonRef?: RefObject<View | null>;
}) {
  return (
    <Pressable
      ref={buttonRef}
      style={styles.footerIconButton}
      testID={testID}
      nativeID={testID}
      collapsable={false}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
    >
      {({ hovered }) => (
        <Icon
          size={iconSize ?? theme.iconSize.md}
          color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      )}
    </Pressable>
  );
}

function SidebarHostPicker({
  theme,
  onAddHost,
  onOpenHostSettings,
}: {
  theme: SidebarTheme;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
}) {
  const hosts = useHosts();
  const triggerRef = useRef<View | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => setIsOpen(true), []);

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showLocalMarker
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
      hostLocalMarkerTestID={sidebarHostLocalMarkerTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        accessibilityLabel="Hosts"
        icon={Server}
        iconSize={theme.iconSize.sm}
        theme={theme}
      />
    </HostPicker>
  );
}

function AddProjectTooltipContent({
  newAgentKeys,
  label,
}: {
  newAgentKeys: ReturnType<typeof useShortcutKeys>;
  label: string;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {newAgentKeys ? <Shortcut chord={newAgentKeys} /> : null}
    </View>
  );
}

function HeaderIconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

function SidebarFooter({
  theme,
  handleOpenProject,
  handleHome,
  handleSettings,
  labels,
  isNewThemeSidebar,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  labels: {
    addProject: string;
    home: string;
    settings: string;
    switchHost: string;
    searchHosts: string;
  };
  isNewThemeSidebar: boolean;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");

  return (
    <View style={isNewThemeSidebar ? styles.sidebarFooterFlat : styles.sidebarFooter}>
      <View style={styles.footerIconRow}>
        <SidebarHostPicker
          theme={theme}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
        />
        {!isNewThemeSidebar ? (
          <>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <FooterIconButton
                  onPress={handleOpenProject}
                  testID="sidebar-add-project"
                  accessibilityLabel={labels.addProject}
                  icon={FolderPlus}
                  theme={theme}
                />
              </TooltipTrigger>
              <TooltipContent side="top" align="center" offset={8}>
                <AddProjectTooltipContent newAgentKeys={newAgentKeys} label={labels.addProject} />
              </TooltipContent>
            </Tooltip>
            <FooterIconButton
              onPress={handleHome}
              testID="sidebar-home"
              accessibilityLabel={labels.home}
              icon={Home}
              theme={theme}
            />
          </>
        ) : null}
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          accessibilityLabel={labels.settings}
          icon={Settings}
          theme={theme}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  theme,
  statusWorkspacePlacements,
  projects,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  activeServerId,
  isNewThemeSidebar,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleNewWorkspaceNavigate,
  handleNewWorkspaceForHost,
  handleOpenProject,
  handleOpenProjectFolder,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  isOpen,
  closeSidebar,
  handleViewMoreNavigate,
  handleSchedulesNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const isSessionsActive = pathname.includes("/sessions");
  const toolbarLabels = useMemo(
    () => ({
      newConversation: labels.newConversation,
      openProject: labels.openProject,
      history: labels.history,
      schedules: labels.schedules,
      close: labels.closeSidebar,
    }),
    [labels],
  );
  const isSchedulesActive = pathname.includes("/schedules");
  const showSchedules = isElectronRuntime();
  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    overlayVisible,
    isGesturing,
    mobilePanelState,
    gestureAnimatingRef,
    closeGestureRef,
  } = useSidebarAnimation();
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  const handleCloseFromGesture = useCallback(() => {
    gestureAnimatingRef.current = true;
    closeSidebar();
  }, [closeSidebar, gestureAnimatingRef]);

  const handleViewMore = useCallback(() => {
    translateX.value = -windowWidth;
    backdropOpacity.value = 0;
    closeSidebar();
    handleViewMoreNavigate();
  }, [backdropOpacity, closeSidebar, handleViewMoreNavigate, translateX, windowWidth]);

  const handleSchedules = useCallback(() => {
    translateX.value = -windowWidth;
    backdropOpacity.value = 0;
    closeSidebar();
    handleSchedulesNavigate();
  }, [backdropOpacity, closeSidebar, handleSchedulesNavigate, translateX, windowWidth]);

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const handleNewWorkspace = useCallback(() => {
    closeSidebar();
    handleNewWorkspaceNavigate();
  }, [closeSidebar, handleNewWorkspaceNavigate]);

  const handleNewChatForHost = useCallback(
    (serverId: string) => {
      closeSidebar();
      handleNewWorkspaceForHost(serverId);
    },
    [closeSidebar, handleNewWorkspaceForHost],
  );

  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(true)
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          closeTouchStartX.value = touch.absoluteX;
          closeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }

          const deltaX = touch.absoluteX - closeTouchStartX.value;
          const deltaY = touch.absoluteY - closeTouchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          if (!canCloseLeftSidebarGesture(mobilePanelState.value)) {
            stateManager.fail();
            return;
          }

          if (deltaX >= 10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }
          if (deltaX <= -15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          const newTranslateX = Math.min(0, Math.max(-windowWidth, event.translationX));
          translateX.value = newTranslateX;
          backdropOpacity.value = interpolate(
            newTranslateX,
            [-windowWidth, 0],
            [0, 1],
            Extrapolation.CLAMP,
          );
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose = event.translationX < -windowWidth / 3 || event.velocityX < -500;
          if (shouldClose) {
            animateToClose();
            runOnJS(handleCloseFromGesture)();
          } else {
            animateToOpen();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
      isGesturing,
      mobilePanelState,
      windowWidth,
      translateX,
      backdropOpacity,
      animateToClose,
      animateToOpen,
      handleCloseFromGesture,
    ],
  );

  const mobileSidebarInsetStyle = useMemo(
    () => ({ width: windowWidth, paddingTop: insetsTop, paddingBottom: insetsBottom }),
    [windowWidth, insetsTop, insetsBottom],
  );

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  let overlayPointerEvents: "auto" | "none" | "box-none";
  if (!isWeb) overlayPointerEvents = "box-none";
  else if (isOpen) overlayPointerEvents = "auto";
  else overlayPointerEvents = "none";

  const backdropStyle = useMemo(
    () => [
      staticStyles.backdrop,
      backdropAnimatedStyle,
      // pointerEvents is React-owned, not worklet-owned: Reanimated never
      // touches it, so a stale animated-prop revert can't wedge an invisible
      // tap-eating backdrop.
      { pointerEvents: isOpen ? ("auto" as const) : ("none" as const) },
    ],
    [backdropAnimatedStyle, isOpen],
  );
  const mobileSidebarStyle = useMemo(
    () => [
      staticStyles.mobileSidebar,
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
      { backgroundColor: theme.colors.surfaceSidebar },
    ],
    [mobileSidebarInsetStyle, sidebarAnimatedStyle, theme.colors.surfaceSidebar],
  );
  // display is React-owned on the plain wrapper View (no animated styles), so
  // a hidden overlay stays hidden no matter what Reanimated's Fabric overlay
  // reverts the panel transform to after a heavy commit (reanimated#9635).
  const overlayStyle = useMemo(
    () => [
      StyleSheet.absoluteFillObject,
      { display: overlayVisible ? ("flex" as const) : ("none" as const) },
    ],
    [overlayVisible],
  );

  return (
    <View style={overlayStyle} pointerEvents={overlayPointerEvents}>
      <Animated.View style={backdropStyle} />

      <GestureDetector gesture={closeGesture} touchAction="pan-y">
        <Animated.View style={mobileSidebarStyle} pointerEvents="auto">
          <View style={styles.sidebarContent} pointerEvents="auto">
            {isNewThemeSidebar ? (
              <>
                <SidebarSessionsToolbar
                  labels={toolbarLabels}
                  onNewConversation={handleNewWorkspace}
                  onOpenProject={handleOpenProjectFolder}
                  onHistory={handleViewMore}
                  isHistoryActive={isSessionsActive}
                  onSchedules={showSchedules ? handleSchedules : undefined}
                  isSchedulesActive={isSchedulesActive}
                  onClose={closeSidebar}
                />
                <SidebarSessionsList
                  serverId={activeServerId}
                  parentGestureRef={closeGestureRef}
                  onNewChatForHost={handleNewChatForHost}
                />
              </>
            ) : (
              <>
                <View style={styles.sidebarHeaderGroup}>
                  <SidebarHeaderRow
                    icon={FolderPlus}
                    label={labels.openProject}
                    onPress={handleOpenProject}
                    testID="sidebar-global-open-project"
                    variant="compact"
                    shortcutKeys={newWorkspaceKeys}
                  />
                  {showSchedules ? (
                    <SidebarHeaderRow
                      icon={CalendarClock}
                      label={labels.schedules}
                      onPress={handleSchedules}
                      isActive={isSchedulesActive}
                      testID="sidebar-schedules"
                      variant="compact"
                    />
                  ) : null}
                  <SidebarHeaderRow
                    icon={History}
                    label={labels.sessions}
                    onPress={handleViewMore}
                    isActive={isSessionsActive}
                    testID="sidebar-sessions"
                    variant="compact"
                  />
                </View>
                <WorkspacesSectionHeader onNewWorkspacePress={handleNewWorkspace} />
                <Pressable
                  style={styles.mobileCloseButton}
                  onPress={closeSidebar}
                  testID="sidebar-close"
                  nativeID="sidebar-close"
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={labels.closeSidebar}
                  hitSlop={8}
                >
                  {({ hovered, pressed }) => (
                    <X
                      size={theme.iconSize.md}
                      color={
                        hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                      }
                    />
                  )}
                </Pressable>

                {isInitialLoad ? (
                  <SidebarAgentListSkeleton />
                ) : (
                  <SidebarWorkspaceList
                    collapsedProjectKeys={collapsedProjectKeys}
                    onToggleProjectCollapsed={toggleProjectCollapsed}
                    shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
                    groupMode={groupMode}
                    statusWorkspacePlacements={statusWorkspacePlacements}
                    projects={projects}
                    projectNamesByKey={projectNamesByKey}
                    isRefreshing={isManualRefresh && isRevalidating}
                    onRefresh={handleRefresh}
                    onWorkspacePress={handleWorkspacePress}
                    onAddProject={handleOpenProject}
                    parentGestureRef={closeGestureRef}
                  />
                )}
              </>
            )}

            <SidebarFooter
              theme={theme}
              handleOpenProject={handleOpenProject}
              handleHome={handleHome}
              handleSettings={handleSettings}
              labels={labels}
              isNewThemeSidebar={isNewThemeSidebar}
              handleAddHost={handleAddHost}
              handleOpenHostSettings={handleOpenHostSettings}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function DesktopSidebar({
  theme,
  statusWorkspacePlacements,
  projects,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  activeServerId,
  isNewThemeSidebar,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleNewWorkspaceNavigate,
  handleNewWorkspaceForHost,
  handleOpenProject,
  handleOpenProjectFolder,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  isOpen,
  handleViewMore,
  handleSchedulesNavigate,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const isSessionsActive = pathname.includes("/sessions");
  const toolbarLabels = useMemo(
    () => ({
      newConversation: labels.newConversation,
      openProject: labels.openProject,
      history: labels.history,
      schedules: labels.schedules,
      close: labels.closeSidebar,
    }),
    [labels],
  );
  const isSchedulesActive = pathname.includes("/schedules");
  const showSchedules = isElectronRuntime();
  const padding = useWindowControlsPadding("sidebar");
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();

  const startWidthRef = useRef(sidebarWidth);
  const resizeWidth = useSharedValue(sidebarWidth);

  useEffect(() => {
    resizeWidth.value = sidebarWidth;
  }, [sidebarWidth, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = sidebarWidth;
          resizeWidth.value = sidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const maxWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [sidebarWidth, resizeWidth, setSidebarWidth, viewportWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const paddingTopSpacerStyle = useMemo(() => ({ height: padding.top }), [padding.top]);
  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const resizeHandleStyle = useMemo(
    // The resize handle is a plain View, so the whole-sidebar drag region below
    // would otherwise treat it as a window-drag handle. Opt it out of dragging so
    // the resize gesture keeps working (no-op outside Electron).
    () => [
      styles.resizeHandle,
      isWeb && ({ cursor: "col-resize", WebkitAppRegion: "no-drag" } as object),
    ],
    [],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={desktopSidebarBorderStyle}>
        {/* Whole-sidebar window drag region (Electron). Every non-interactive
            area of the sidebar — gaps, section headers, empty list space — acts
            as a window-drag handle. Pressables render with a tabIndex on web, so
            the global no-drag backstop in public/index.html carves them out
            automatically; the only plain-View control that needs an explicit
            no-drag is the resize handle below. */}
        <TitlebarDragRegion />
        {isNewThemeSidebar ? (
          <>
            <View style={styles.sidebarDragArea}>
              {padding.top > 0 ? <View style={paddingTopSpacerStyle} /> : null}
              <SidebarSessionsToolbar
                labels={toolbarLabels}
                onNewConversation={handleNewWorkspaceNavigate}
                onOpenProject={handleOpenProjectFolder}
                onHistory={handleViewMore}
                isHistoryActive={isSessionsActive}
                onSchedules={showSchedules ? handleSchedulesNavigate : undefined}
                isSchedulesActive={isSchedulesActive}
              />
            </View>
            <SidebarSessionsList
              serverId={activeServerId}
              onNewChatForHost={handleNewWorkspaceForHost}
            />
          </>
        ) : (
          <>
            <View style={styles.sidebarDragArea}>
              {padding.top > 0 ? <View style={paddingTopSpacerStyle} /> : null}
              <View style={styles.sidebarHeaderGroup}>
                <SidebarHeaderRow
                  icon={FolderPlus}
                  label={labels.openProject}
                  onPress={handleOpenProject}
                  testID="sidebar-global-open-project"
                  variant="compact"
                  shortcutKeys={newWorkspaceKeys}
                />
                {showSchedules ? (
                  <SidebarHeaderRow
                    icon={CalendarClock}
                    label={labels.schedules}
                    onPress={handleSchedulesNavigate}
                    isActive={isSchedulesActive}
                    testID="sidebar-schedules"
                    variant="compact"
                  />
                ) : null}
                <SidebarHeaderRow
                  icon={History}
                  label={labels.sessions}
                  onPress={handleViewMore}
                  isActive={isSessionsActive}
                  testID="sidebar-sessions"
                  variant="compact"
                />
              </View>
            </View>
            <WorkspacesSectionHeader onNewWorkspacePress={handleNewWorkspaceNavigate} />

            {isInitialLoad ? (
              <SidebarAgentListSkeleton />
            ) : (
              <SidebarWorkspaceList
                collapsedProjectKeys={collapsedProjectKeys}
                onToggleProjectCollapsed={toggleProjectCollapsed}
                shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
                groupMode={groupMode}
                statusWorkspacePlacements={statusWorkspacePlacements}
                projects={projects}
                projectNamesByKey={projectNamesByKey}
                isRefreshing={isManualRefresh && isRevalidating}
                onRefresh={handleRefresh}
                onAddProject={handleOpenProject}
              />
            )}
          </>
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleOpenProject={handleOpenProject}
          handleHome={handleHome}
          handleSettings={handleSettings}
          labels={labels}
          isNewThemeSidebar={isNewThemeSidebar}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeGesture}>
          <View style={resizeHandleStyle} />
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

function WorkspacesSectionHeader({ onNewWorkspacePress }: { onNewWorkspacePress: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const handleSearchPress = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const searchButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>{t("sidebar.sections.workspaces")}</Text>
      <View style={styles.workspacesSectionActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.workspace.actions.newWorkspace")}
              testID="sidebar-new-workspace"
              style={searchButtonStyle}
              onPress={onNewWorkspacePress}
            >
              {({ hovered, pressed }) => (
                <Plus
                  size={14}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <HeaderIconTooltipContent label={t("sidebar.workspace.actions.newWorkspace")} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.actions.openCommandCenter")}
              testID="sidebar-command-center-search"
              style={searchButtonStyle}
              onPress={handleSearchPress}
            >
              {({ hovered, pressed }) => (
                <Search
                  size={14}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <HeaderIconTooltipContent
              label={t("common.actions.search")}
              shortcutKeys={commandCenterKeys}
            />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <HeaderIconTooltipContent label={t("sidebar.actions.displayPreferences")} />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  backdrop: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  mobileSidebar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    bottom: 0,
    overflow: "hidden" as const,
  },
  desktopSidebar: {
    position: "relative" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    // Distance from History's bottom edge to the divider. WorkspacesSectionHeader
    // uses a slightly smaller paddingTop to balance the action buttons' centering
    // offset so the divider reads as visually centered between the two.
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Align the title with the compact rows' icons and the project icons below
    // (listContent + projectRow inner padding both spacing[2]).
    paddingLeft: theme.spacing[2] + theme.spacing[2],
    // Align the trailing action pill's right edge with the New workspace and
    // project row pills (both 8px from the sidebar edge).
    paddingRight: theme.spacing[2],
    // Less than sidebarHeaderGroup's paddingBottom: the 28px-tall action buttons
    // center the title and add their own offset above it, so equal padding reads
    // as a larger gap than History's. Trim paddingTop to balance it visually.
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  workspacesHeaderIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  workspacesHeaderIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButton: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[4],
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: theme.shell.chromeDivider,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarDragArea: {
    position: "relative",
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sidebarFooterFlat: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  footerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
