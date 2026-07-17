import { router, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  Command,
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
  TextInput,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/sidebar-display-preferences-menu";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { pickDirectory } from "@/desktop/pick-directory";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useOpenProject } from "@/hooks/use-open-project";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHosts } from "@/runtime/host-runtime";
import {
  getLastWorkspaceSelection,
  navigateToWorkspace,
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { resolveSshExitWorkspace } from "@/screens/ssh/ssh-sidebar-toggle";
import { useWorkspace } from "@/stores/session-store-hooks";
import { usePanelStore } from "@/stores/panel-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
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
import { SidebarSshList } from "@/components/sidebar/sidebar-ssh-list";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  statusGroups: StatusGroup[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: Map<string, string>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  activeServerId: string | null;
  /** Fork "new theme": render the flat recency sessions layout instead of the grouped list. */
  isNewThemeSidebar: boolean;
  /** Host advertises the SSH manager feature: the SSH entry replaces Schedules. */
  sshEnabled: boolean;
  /** Whether the sidebar body currently shows the SSH manager vs the session list. */
  isSshContent: boolean;
  /**
   * Toggle the sidebar body between the session list and the SSH manager.
   * Returns true when exiting SSH mode navigated the main panel back to the
   * workspace the user entered from (so compact layouts can close the drawer).
   */
  onToggleSshContent: () => boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectKey: string) => void;
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
  hosts: string;
  home: string;
  settings: string;
  searchHosts: string;
  sessions: string;
  history: string;
  schedules: string;
  ssh: string;
  closeSidebar: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
  handleSchedulesNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
  handleViewMore: () => void;
  handleSchedulesNavigate: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({ active }: { active: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  // Fork "new theme" swaps the project-grouped list for a flat recency sessions
  // list + top toolbar. Read the device-local setting that drives the theme so
  // the layout branch tracks it reactively (see docs/new-theme.md).
  const isNewThemeSidebar = settings.newThemeEnabled;
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const pathname = usePathname();
  const hosts = useHosts();
  const activeServerId = useMemo(
    () => parseServerIdFromPathname(pathname) ?? hosts[0]?.serverId ?? null,
    [hosts, pathname],
  );

  const {
    projects,
    workspaceEntriesByKey,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    statusGroups,
    pinnedGroups,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;
  // SSH host manager: the top entry replaces Schedules and toggles the sidebar
  // body in place. Gated on the host advertising the feature.
  const sshEnabled = useHostFeature(activeServerId, "sshHosts");
  const sidebarContentMode = useSidebarViewStore((state) => state.contentMode);
  const setSidebarContentMode = useSidebarViewStore((state) => state.setContentMode);
  const isSshContent = sshEnabled && sidebarContentMode === "ssh";
  // Workspace that was active when SSH mode was entered, so the second tap on
  // the SSH entry can land the main panel back where the user started.
  const sshEntrySelectionRef = useRef<ActiveWorkspaceSelection | null>(null);
  const onToggleSshContent = useCallback((): boolean => {
    if (sidebarContentMode !== "ssh") {
      sshEntrySelectionRef.current = getLastWorkspaceSelection();
      setSidebarContentMode("ssh");
      return false;
    }
    setSidebarContentMode("sessions");
    const returnTo = resolveSshExitWorkspace({
      pathname,
      entrySelection: sshEntrySelectionRef.current,
      lastSelection: getLastWorkspaceSelection(),
    });
    sshEntrySelectionRef.current = null;
    if (returnTo) {
      navigateToWorkspace({
        serverId: returnTo.serverId,
        workspaceId: returnTo.workspaceId,
      });
      return true;
    }
    return false;
  }, [pathname, setSidebarContentMode, sidebarContentMode]);

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

  const openProjectPicker = useOpenAddProject();
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
          sourceDirectory: result.project.projectRootPath,
          projectId: result.project.projectId,
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
      hosts: t("sidebar.actions.hosts"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      sessions: t("sidebar.sections.sessions"),
      history: t("sidebar.sessionsList.history"),
      schedules: t("sidebar.sections.schedules"),
      ssh: t("ssh.title"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    statusGroups,
    pinnedGroups,
    projects,
    workspaceEntriesByKey,
    projectNamesByKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    activeServerId,
    isNewThemeSidebar,
    sshEnabled,
    isSshContent,
    onToggleSshContent,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    handleNewWorkspaceNavigate,
    handleNewWorkspaceForHost,
    labels,
    newWorkspaceKeys,
  };

  if (isCompactLayout) {
    return (
      <RetainedPanelActivity active={active}>
        <MobileSidebar
          {...sharedProps}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          closeSidebar={showMobileAgent}
          handleOpenProject={handleOpenProjectMobile}
          handleOpenProjectFolder={handleOpenProjectFolderMobile}
          handleHome={handleHomeMobile}
          handleSettings={handleSettingsMobile}
          handleAddHost={handleAddHostMobile}
          handleOpenHostSettings={handleOpenHostSettingsMobile}
          handleViewMoreNavigate={handleViewMoreNavigate}
          handleSchedulesNavigate={handleSchedulesNavigate}
        />
      </RetainedPanelActivity>
    );
  }

  return (
    <RetainedPanelActivity active={active}>
      <DesktopSidebar
        {...sharedProps}
        insetsTop={insets.top}
        active={active}
        handleOpenProject={handleOpenProjectDesktop}
        handleOpenProjectFolder={handleOpenProjectFolderDesktop}
        handleHome={handleHomeDesktop}
        handleSettings={handleSettingsDesktop}
        handleAddHost={handleAddHostDesktop}
        handleOpenHostSettings={handleOpenHostSettingsDesktop}
        handleViewMore={handleViewMoreNavigate}
        handleSchedulesNavigate={handleSchedulesNavigate}
      />
    </RetainedPanelActivity>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

// The top sidebar entry above History: SSH when the host supports it, else the
// Schedules entry (Electron desktop), else nothing. Kept as a component to keep
// both classic layouts free of a nested ternary.
function SidebarPrimaryEntry({
  sshEnabled,
  isSshContent,
  onToggleSsh,
  sshLabel,
  showSchedules,
  isSchedulesActive,
  onSchedules,
  schedulesLabel,
}: {
  sshEnabled: boolean;
  isSshContent: boolean;
  onToggleSsh: () => void;
  sshLabel: string;
  showSchedules: boolean;
  isSchedulesActive: boolean;
  onSchedules: () => void;
  schedulesLabel: string;
}) {
  if (sshEnabled) {
    return (
      <SidebarHeaderRow
        icon={Server}
        label={sshLabel}
        onPress={onToggleSsh}
        isActive={isSshContent}
        testID="sidebar-ssh"
        variant="compact"
      />
    );
  }
  if (showSchedules) {
    return (
      <SidebarHeaderRow
        icon={CalendarClock}
        label={schedulesLabel}
        onPress={onSchedules}
        isActive={isSchedulesActive}
        testID="sidebar-schedules"
        variant="compact"
      />
    );
  }
  return null;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon: Icon,
  iconSize,
  shortcutKeys,
  theme,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: typeof FolderPlus;
  iconSize?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  theme: SidebarTheme;
  buttonRef?: RefObject<View | null>;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={styles.footerIconButton}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
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
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarHostPicker({
  theme,
  label,
  onAddHost,
  onOpenHostSettings,
}: {
  theme: SidebarTheme;
  label: string;
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
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        label={label}
        icon={Server}
        iconSize={theme.iconSize.sm}
        theme={theme}
      />
    </HostPicker>
  );
}

function IconTooltipContent({
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

function AddProjectTooltipContent({
  newAgentKeys,
  label,
}: {
  newAgentKeys: ReturnType<typeof useShortcutKeys>;
  label: string;
}) {
  return <IconTooltipContent label={label} shortcutKeys={newAgentKeys} />;
}

const SidebarNewWorkspaceHeaderRow = memo(function SidebarNewWorkspaceHeaderRow({
  label,
  testID,
  variant,
  shortcutKeys,
  onBeforeNavigate,
}: {
  label: string;
  testID: string;
  variant: "header" | "compact";
  shortcutKeys: ShortcutKey[][] | null;
  onBeforeNavigate?: () => void;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={label}
      onPress={handlePress}
      testID={testID}
      variant={variant}
      shortcutKeys={shortcutKeys}
    />
  );
});

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
    hosts: string;
    home: string;
    settings: string;
    searchHosts: string;
  };
  isNewThemeSidebar: boolean;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");

  return (
    <View style={isNewThemeSidebar ? styles.sidebarFooterFlat : styles.sidebarFooter}>
      <View style={styles.footerIconRow}>
        <SidebarHostPicker
          theme={theme}
          label={labels.hosts}
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
                  label={labels.addProject}
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
              label={labels.home}
              icon={Home}
              theme={theme}
            />
          </>
        ) : null}
        <SidebarHelpMenu />
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          label={labels.settings}
          icon={Settings}
          shortcutKeys={settingsKeys}
          theme={theme}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  theme,
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  activeServerId,
  isNewThemeSidebar,
  sshEnabled,
  isSshContent,
  onToggleSshContent,
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
      ssh: labels.ssh,
      close: labels.closeSidebar,
    }),
    [labels],
  );
  const isSchedulesActive = pathname.includes("/schedules");
  const showSchedules = isElectronRuntime();
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();

  const handleViewMore = useCallback(() => {
    closeSidebar();
    handleViewMoreNavigate();
  }, [closeSidebar, handleViewMoreNavigate]);

  const handleSchedules = useCallback(() => {
    closeSidebar();
    handleSchedulesNavigate();
  }, [closeSidebar, handleSchedulesNavigate]);

  // Toggling into SSH mode keeps the drawer open (the SSH list lives in it);
  // toggling back out closes the drawer only when the toggle navigated the
  // main panel back to the workspace the user entered from.
  const handleToggleSsh = useCallback(() => {
    if (onToggleSshContent()) {
      closeSidebar();
    }
  }, [closeSidebar, onToggleSshContent]);

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

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  // Classic workspace body (skeleton while loading, else the grouped list).
  // Held in a variable so the SSH branch below is a flat, single ternary.
  const classicWorkspaceBody = isInitialLoad ? (
    <SidebarAgentListSkeleton />
  ) : (
    <SidebarWorkspaceList
      collapsedProjectKeys={collapsedProjectKeys}
      onToggleProjectCollapsed={toggleProjectCollapsed}
      shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
      groupMode={groupMode}
      statusGroups={statusGroups}
      pinnedGroups={pinnedGroups}
      workspaceEntriesByKey={workspaceEntriesByKey}
      projects={projects}
      projectNamesByKey={projectNamesByKey}
      isRefreshing={isManualRefresh && isRevalidating}
      onRefresh={handleRefresh}
      onWorkspacePress={handleWorkspacePress}
      onAddProject={handleOpenProject}
      parentGestureRef={closeGestureRef}
    />
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />
        {isNewThemeSidebar ? (
          <>
            <SidebarSessionsToolbar
              labels={toolbarLabels}
              onNewConversation={handleNewWorkspace}
              onOpenProject={handleOpenProjectFolder}
              onHistory={handleViewMore}
              isHistoryActive={isSessionsActive}
              onSsh={sshEnabled ? handleToggleSsh : undefined}
              isSshActive={isSshContent}
              onSchedules={showSchedules ? handleSchedules : undefined}
              isSchedulesActive={isSchedulesActive}
              onClose={closeSidebar}
            />
            {isSshContent ? (
              <SidebarSshList serverId={activeServerId} onNavigate={closeSidebar} />
            ) : (
              <SidebarSessionsList
                serverId={activeServerId}
                parentGestureRef={closeGestureRef}
                onNewChatForHost={handleNewChatForHost}
              />
            )}
          </>
        ) : (
          <>
            <View style={styles.sidebarHeaderGroup}>
              <SidebarNewWorkspaceHeaderRow
                label={labels.newWorkspace}
                testID="sidebar-global-new-workspace"
                variant="compact"
                shortcutKeys={newWorkspaceKeys}
                onBeforeNavigate={closeSidebar}
              />
              <SidebarPrimaryEntry
                sshEnabled={sshEnabled}
                isSshContent={isSshContent}
                onToggleSsh={handleToggleSsh}
                sshLabel={labels.ssh}
                showSchedules={showSchedules}
                isSchedulesActive={isSchedulesActive}
                onSchedules={handleSchedules}
                schedulesLabel={labels.schedules}
              />
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
            <WindowChromeSafeArea placement="inline" style={styles.mobileCloseButtonRow}>
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
            </WindowChromeSafeArea>

            {isSshContent ? (
              <SidebarSshList serverId={activeServerId} onNavigate={closeSidebar} />
            ) : (
              classicWorkspaceBody
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
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({
  theme,
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  activeServerId,
  isNewThemeSidebar,
  sshEnabled,
  isSshContent,
  onToggleSshContent,
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
  active,
  handleViewMore,
  handleSchedulesNavigate,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const pathname = usePathname();
  const isSessionsActive = pathname.includes("/sessions");
  const toolbarLabels = useMemo(
    () => ({
      newConversation: labels.newConversation,
      openProject: labels.openProject,
      history: labels.history,
      schedules: labels.schedules,
      ssh: labels.ssh,
      close: labels.closeSidebar,
    }),
    [labels],
  );
  const isSchedulesActive = pathname.includes("/schedules");
  const showSchedules = isElectronRuntime();
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = visibleSidebarWidth;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [resizeWidth, setSidebarWidth, viewportWidth, visibleSidebarWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [
      staticStyles.desktopSidebar,
      !active && staticStyles.desktopSidebarHidden,
      resizeAnimatedStyle,
    ],
    [active, resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [styles.sidebarHeaderGroup, ownsTopLeft && styles.sidebarHeaderGroupBelowChrome],
    [ownsTopLeft],
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

  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        {/* Whole-sidebar window drag region (Electron). Every non-interactive
            area of the sidebar — gaps, section headers, empty list space — acts
            as a window-drag handle. Pressables render with a tabIndex on web, so
            the global no-drag backstop in public/index.html carves them out
            automatically; the only plain-View control that needs an explicit
            no-drag is the resize handle below. When this sidebar owns the
            top-left window-chrome corner, wrap the drag region in a fixed-height
            chrome row so native window controls have stable clearance. */}
        {ownsTopLeft ? (
          <View style={styles.desktopChromeRow}>
            <TitlebarDragRegion />
          </View>
        ) : (
          <TitlebarDragRegion />
        )}
        {isNewThemeSidebar ? (
          <>
            <View style={styles.sidebarDragArea}>
              <SidebarSessionsToolbar
                labels={toolbarLabels}
                onNewConversation={handleNewWorkspaceNavigate}
                onOpenProject={handleOpenProjectFolder}
                onHistory={handleViewMore}
                isHistoryActive={isSessionsActive}
                onSsh={sshEnabled ? onToggleSshContent : undefined}
                isSshActive={isSshContent}
                onSchedules={showSchedules ? handleSchedulesNavigate : undefined}
                isSchedulesActive={isSchedulesActive}
              />
            </View>
            {isSshContent ? (
              <SidebarSshList serverId={activeServerId} />
            ) : (
              <SidebarSessionsList
                serverId={activeServerId}
                onNewChatForHost={handleNewWorkspaceForHost}
              />
            )}
          </>
        ) : (
          <>
            <View style={styles.sidebarDragArea}>
              <View style={sidebarHeaderGroupStyle}>
                <SidebarNewWorkspaceHeaderRow
                  label={labels.newWorkspace}
                  testID="sidebar-global-new-workspace"
                  variant="compact"
                  shortcutKeys={newWorkspaceKeys}
                />
                <SidebarPrimaryEntry
                  sshEnabled={sshEnabled}
                  isSshContent={isSshContent}
                  onToggleSsh={onToggleSshContent}
                  sshLabel={labels.ssh}
                  showSchedules={showSchedules}
                  isSchedulesActive={isSchedulesActive}
                  onSchedules={handleSchedulesNavigate}
                  schedulesLabel={labels.schedules}
                />
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
            {isSshContent ? (
              <SidebarSshList serverId={activeServerId} />
            ) : (
              <>
                <WorkspacesSectionHeader onNewWorkspacePress={handleNewWorkspaceNavigate} />

                {isInitialLoad ? (
                  <SidebarAgentListSkeleton />
                ) : (
                  <SidebarWorkspaceList
                    collapsedProjectKeys={collapsedProjectKeys}
                    onToggleProjectCollapsed={toggleProjectCollapsed}
                    shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
                    groupMode={groupMode}
                    statusGroups={statusGroups}
                    pinnedGroups={pinnedGroups}
                    workspaceEntriesByKey={workspaceEntriesByKey}
                    projects={projects}
                    projectNamesByKey={projectNamesByKey}
                    isRefreshing={isManualRefresh && isRevalidating}
                    onRefresh={handleRefresh}
                    onAddProject={handleOpenProject}
                  />
                )}
              </>
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
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handleOpenCommandCenter = useCallback(
    () => setCommandCenterOpen(true),
    [setCommandCenterOpen],
  );
  const searchQuery = useSidebarViewStore((state) => state.searchQuery);
  const setSearchQuery = useSidebarViewStore((state) => state.setSearchQuery);
  // Start open when a persisted query is already filtering the list, so the
  // field is visible to explain why the list is narrowed (and to clear it).
  const [isSearchActive, setIsSearchActive] = useState(() => searchQuery.trim().length > 0);
  const searchInputRef = useRef<TextInput>(null);

  const handleSearchPress = useCallback(() => {
    const nextActive = !isSearchActive;
    setIsSearchActive(nextActive);
    if (nextActive) {
      // Focus the input on the next frame after it mounts
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
    // Closing keeps the query: searchQuery lives in sidebar-view-store and is
    // included in its partialize, so the filter survives toggling the field shut
    // and reopening it, and across app restarts.
  }, [isSearchActive]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  }, [setSearchQuery]);

  const handleSubmitSearch = useCallback(() => {
    // Keep input visible after submit — no-op
  }, []);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
    },
    [setSearchQuery],
  );

  const searchButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.workspacesSectionHeader}>
      {isSearchActive ? (
        <View style={styles.searchInputContainer}>
          <Search size={14} color={theme.colors.foregroundMuted} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder={t("sidebar.search.placeholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={searchQuery}
            onChangeText={handleSearchChange}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmitSearch}
            testID="sidebar-project-search-input"
          />
          {searchQuery.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.search.clear")}
              onPress={handleClearSearch}
              style={styles.searchClearButton}
            >
              <X size={12} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={styles.workspacesSectionTitle}>{t("sidebar.sections.workspaces")}</Text>
      )}
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
            <IconTooltipContent label={t("sidebar.workspace.actions.newWorkspace")} />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.actions.openCommandCenter")}
              testID="sidebar-command-center-open"
              style={styles.workspacesHeaderIconButton}
              onPress={handleOpenCommandCenter}
            >
              {({ hovered, pressed }) => (
                <Command
                  size={14}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent
              label={t("sidebar.actions.commandCenter")}
              shortcutKeys={commandCenterKeys}
            />
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isSearchActive ? t("sidebar.search.closeAccessibility") : t("sidebar.search.open")
              }
              testID="sidebar-project-search-toggle"
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
            <IconTooltipContent
              label={isSearchActive ? t("sidebar.search.close") : t("sidebar.search.open")}
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
            <IconTooltipContent label={t("sidebar.actions.displayPreferences")} />
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
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopSidebarHidden: {
    display: "none",
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
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]), so the
    // title lands at spacing[2] left to align with project icons, and the trailing
    // pill sits flush with the list edge on the right.
    paddingLeft: theme.spacing[2],
    paddingRight: 0,
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
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[1],
    height: 28,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  searchInput: {
    flex: 1,
    // Fill the 28px container so the web <input> isn't collapsed to its line
    // box (which renders noticeably shorter than the surrounding pill).
    height: "100%",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  searchClearButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButtonRow: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "flex-end",
    pointerEvents: "box-none",
  },
  mobileCloseButton: {
    marginRight: theme.spacing[4],
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
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
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
