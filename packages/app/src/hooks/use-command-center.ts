import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TextInput } from "react-native";
import { router, usePathname, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { useAllAgentsList } from "@/hooks/use-all-agents-list";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import {
  clearCommandCenterFocusRestoreElement,
  takeCommandCenterFocusRestoreElement,
} from "@/utils/command-center-focus-restore";
import {
  buildHostOpenProjectRoute,
  buildSettingsRoute,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { chordStringToShortcutKeys } from "@/keyboard/shortcut-string";
import { getBindingIdForAction, getDefaultKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getIsElectronRuntime } from "@/constants/layout";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { focusWithRetries } from "@/utils/web-focus";
import { useActiveServerId } from "@/hooks/use-active-server-id";
import { isWeb } from "@/constants/platform";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import type { DirectorySuggestionsResponse } from "@getpaseo/protocol/messages";

interface CommandCenterFileMatch {
  path: string;
  name: string;
  directory: string;
}

function normalizeSuggestionPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") {
    return null;
  }
  const trimmed = path.trim().replace(/\\/g, "/");
  return trimmed.length > 0 ? trimmed : null;
}

function buildCommandCenterFileMatch(path: string): CommandCenterFileMatch {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? path;
  const directory = segments.length > 1 ? segments.slice(0, -1).join("/") : ".";

  return {
    path,
    name,
    directory,
  };
}

function resolveCommandCenterWorkspaceScope(input: {
  pathname: string;
  agents: Array<{ id: string; cwd: string; serverId: string }>;
}): { serverId: string; workspaceId: string } | null {
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(input.pathname);
  if (workspaceRoute) {
    return workspaceRoute;
  }

  const agentRoute = parseHostAgentRouteFromPathname(input.pathname);
  if (!agentRoute) {
    return null;
  }

  const agent = input.agents.find(
    (entry) => entry.serverId === agentRoute.serverId && entry.id === agentRoute.agentId,
  );
  const workspaceId = normalizeSuggestionPath(agent?.cwd);
  if (!workspaceId) {
    return null;
  }

  return {
    serverId: agentRoute.serverId,
    workspaceId,
  };
}

function mapDirectorySuggestionsToCommandCenterFiles(
  payload: DirectorySuggestionsResponse["payload"],
): CommandCenterFileMatch[] {
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return entries.flatMap((entry) => {
    if (!entry || entry.kind !== "file") {
      return [];
    }

    const normalizedPath = normalizeSuggestionPath(entry.path);
    if (!normalizedPath) {
      return [];
    }

    return [buildCommandCenterFileMatch(normalizedPath)];
  });
}

const EMPTY_AGENTS: AggregatedAgent[] = [];
const EMPTY_ACTION_ITEMS: CommandCenterActionItem[] = [];
const EMPTY_FILE_ITEMS: CommandCenterFileItem[] = [];
const EMPTY_COMMAND_CENTER_ITEMS: CommandCenterItem[] = [];

function isMatch(agent: AggregatedAgent, query: string, fallbackTitle: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = (agent.title ?? fallbackTitle).toLowerCase();
  const cwd = agent.cwd.toLowerCase();
  return title.includes(q) || cwd.includes(q);
}

function sortAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftNeedsInput = (left.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  const rightNeedsInput = (right.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  if (leftNeedsInput !== rightNeedsInput) return rightNeedsInput - leftNeedsInput;

  const leftAttention = left.requiresAttention ? 1 : 0;
  const rightAttention = right.requiresAttention ? 1 : 0;
  if (leftAttention !== rightAttention) return rightAttention - leftAttention;

  const leftRunning = left.status === "running" ? 1 : 0;
  const rightRunning = right.status === "running" ? 1 : 0;
  if (leftRunning !== rightRunning) return rightRunning - leftRunning;

  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

interface CommandCenterActionDefinition {
  id: string;
  titleKey:
    | "shell.commandCenter.openProject"
    | "shell.commandCenter.home"
    | "sidebar.actions.settings";
  icon?: "plus" | "settings" | "home";
  actionId?: string;
  keywords: string[];
  routeKind: "settings" | "home" | "none";
}

const COMMAND_CENTER_ACTIONS: readonly CommandCenterActionDefinition[] = [
  {
    id: "new-agent",
    titleKey: "shell.commandCenter.openProject",
    icon: "plus",
    actionId: "new-agent",
    keywords: ["open", "project", "folder", "workspace", "repo"],
    routeKind: "none",
  },
  {
    id: "home",
    titleKey: "shell.commandCenter.home",
    icon: "home",
    keywords: ["home", "start", "import", "session", "pair", "device", "providers"],
    routeKind: "home",
  },
  {
    id: "settings",
    titleKey: "sidebar.actions.settings",
    icon: "settings",
    keywords: ["settings", "preferences", "config", "configuration"],
    routeKind: "settings",
  },
];

function matchesActionQuery(
  query: string,
  action: CommandCenterActionDefinition,
  title: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (title.toLowerCase().includes(normalized)) {
    return true;
  }
  return action.keywords.some((keyword) => keyword.includes(normalized));
}

export interface CommandCenterActionItem {
  kind: "action";
  id: string;
  title: string;
  icon?: "plus" | "settings" | "home";
  route?: Href;
  shortcutKeys?: ShortcutKey[][];
}

type CommandCenterFileItem = CommandCenterFileMatch & {
  workspaceId: string;
  serverId: string;
};

export type CommandCenterItem =
  | {
      kind: "action";
      action: CommandCenterActionItem;
    }
  | {
      kind: "file";
      file: CommandCenterFileItem;
    }
  | {
      kind: "agent";
      agent: AggregatedAgent;
    };

function resolveActionShortcutKeys(
  actionId: string | undefined,
  overrides: Record<string, string>,
): ShortcutKey[][] | undefined {
  if (!actionId) return undefined;
  const isMac = getShortcutOs() === "mac";
  const isDesktopApp = getIsElectronRuntime();
  const platform = { isMac, isDesktop: isDesktopApp };
  const bindingId = getBindingIdForAction(actionId, platform);
  if (!bindingId) return undefined;
  const override = overrides[bindingId];
  if (override) return chordStringToShortcutKeys(override);
  const defaultKeys = getDefaultKeysForAction(actionId, platform);
  return defaultKeys ? [defaultKeys] : undefined;
}

export function useCommandCenter() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const routeActiveServerId = useActiveServerId();
  const { overrides } = useKeyboardShortcutOverrides();
  const open = useKeyboardShortcutsStore((s) => s.commandCenterOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setCommandCenterOpen);
  const inputRef = useRef<TextInput>(null);
  const didNavigateRef = useRef(false);
  const prevOpenRef = useRef(open);
  const activeIndexRef = useRef(0);
  const itemsRef = useRef<CommandCenterItem[]>([]);
  const handleCloseRef = useRef<() => void>(() => undefined);
  const handleSelectItemRef = useRef<(item: CommandCenterItem) => void>(() => undefined);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const activeServerId = open ? routeActiveServerId : null;

  const { agents } = useAllAgentsList({
    serverId: activeServerId,
  });
  const client = useHostRuntimeClient(activeServerId ?? "");
  const isConnected = useHostRuntimeIsConnected(activeServerId ?? "");

  const agentResults = useMemo(() => {
    if (!open || agents.length === 0) {
      return EMPTY_AGENTS;
    }
    const fallbackTitle = t("shell.commandCenter.newAgent");
    const filtered = agents.filter((agent) => isMatch(agent, query, fallbackTitle));
    filtered.sort(sortAgents);
    return filtered;
  }, [agents, open, query, t]);

  const searchWorkspace = useMemo(
    () =>
      resolveCommandCenterWorkspaceScope({
        pathname,
        agents,
      }),
    [agents, pathname],
  );
  const trimmedQuery = query.trim();
  const debouncedFileQuery = useDebouncedValue(trimmedQuery, 300);

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "command-center-file-search",
      searchWorkspace?.serverId ?? "",
      searchWorkspace?.workspaceId ?? "",
      debouncedFileQuery,
    ],
    queryFn: async (): Promise<CommandCenterFileItem[]> => {
      if (!client || !searchWorkspace) {
        return [];
      }
      const response = await client.getDirectorySuggestions({
        cwd: searchWorkspace.workspaceId,
        query: debouncedFileQuery,
        limit: 30,
        includeFiles: true,
        includeDirectories: false,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return mapDirectorySuggestionsToCommandCenterFiles(response).map((entry) =>
        Object.assign(entry, {
          serverId: searchWorkspace.serverId,
          workspaceId: searchWorkspace.workspaceId,
        }),
      );
    },
    enabled:
      open &&
      Boolean(client) &&
      isConnected &&
      searchWorkspace !== null &&
      debouncedFileQuery.length > 0,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const workspaceTabsKey = searchWorkspace
    ? buildWorkspaceTabPersistenceKey({
        serverId: searchWorkspace.serverId,
        workspaceId: searchWorkspace.workspaceId,
      })
    : null;

  const workspaceLayout = useWorkspaceLayoutStore((state) =>
    workspaceTabsKey ? (state.layoutByWorkspace[workspaceTabsKey] ?? null) : null,
  );

  const openFileTabs = useMemo(() => {
    if (!workspaceLayout || !searchWorkspace) {
      return EMPTY_FILE_ITEMS;
    }
    const allTabs = collectAllTabs(workspaceLayout.root);
    const fileTabs: CommandCenterFileItem[] = [];
    for (const tab of allTabs) {
      if (tab.target.kind !== "file") {
        continue;
      }
      fileTabs.push({
        ...buildCommandCenterFileMatch(tab.target.path),
        serverId: searchWorkspace.serverId,
        workspaceId: searchWorkspace.workspaceId,
      });
    }
    return fileTabs.length > 0 ? fileTabs : EMPTY_FILE_ITEMS;
  }, [workspaceLayout, searchWorkspace]);

  const fileItems = useMemo(() => {
    if (trimmedQuery.length === 0) {
      return openFileTabs;
    }
    return fileSuggestionsQuery.data ?? EMPTY_FILE_ITEMS;
  }, [trimmedQuery, openFileTabs, fileSuggestionsQuery.data]);

  const settingsRoute = useMemo<Href>(() => {
    return buildSettingsRoute();
  }, []);

  const homeRoute = useMemo<Href | undefined>(() => {
    if (!routeActiveServerId) return undefined;
    return buildHostOpenProjectRoute(routeActiveServerId) as Href;
  }, [routeActiveServerId]);

  const actionItems = useMemo(() => {
    if (!open) {
      return EMPTY_ACTION_ITEMS;
    }
    return COMMAND_CENTER_ACTIONS.filter((action) => {
      if (action.routeKind === "home" && !homeRoute) return false;
      return matchesActionQuery(query, action, t(action.titleKey));
    }).map<CommandCenterActionItem>((action) => {
      let route: Href | undefined;
      if (action.routeKind === "settings") route = settingsRoute;
      else if (action.routeKind === "home") route = homeRoute;
      return {
        kind: "action",
        id: action.id,
        title: t(action.titleKey),
        icon: action.icon,
        route,
        shortcutKeys: resolveActionShortcutKeys(action.actionId, overrides),
      };
    });
  }, [open, query, settingsRoute, homeRoute, overrides, t]);

  const items = useMemo(() => {
    if (!open) {
      return EMPTY_COMMAND_CENTER_ITEMS;
    }
    const next: CommandCenterItem[] = [];
    for (const action of actionItems) {
      next.push({
        kind: "action",
        action,
      });
    }
    for (const file of fileItems) {
      next.push({
        kind: "file",
        file,
      });
    }
    for (const agent of agentResults) {
      next.push({
        kind: "agent",
        agent,
      });
    }
    return next;
  }, [actionItems, agentResults, fileItems, open]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleSelectAgent = useCallback(
    (agent: AggregatedAgent) => {
      didNavigateRef.current = true;

      // Don't restore focus back to the prior element after we navigate.
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      navigateToAgent({
        serverId: agent.serverId,
        agentId: agent.id,
        currentPathname: pathname,
      });
    },
    [pathname, setOpen],
  );

  const handleSelectFile = useCallback(
    (file: CommandCenterFileItem) => {
      didNavigateRef.current = true;
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      navigateToPreparedWorkspaceTab({
        serverId: file.serverId,
        workspaceId: file.workspaceId,
        target: { kind: "file", path: file.path },
        currentPathname: pathname,
      });
    },
    [pathname, setOpen],
  );

  const openProjectPicker = useOpenProjectPicker(activeServerId);

  const handleSelectAction = useCallback(
    (action: CommandCenterActionItem) => {
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      if (action.id === "new-agent") {
        void openProjectPicker();
        return;
      }
      if (!action.route) {
        return;
      }
      didNavigateRef.current = true;
      router.push(action.route);
    },
    [openProjectPicker, setOpen],
  );

  const handleSelectItem = useCallback(
    (item: CommandCenterItem) => {
      if (item.kind === "action") {
        handleSelectAction(item.action);
        return;
      }
      if (item.kind === "file") {
        handleSelectFile(item.file);
        return;
      }
      handleSelectAgent(item.agent);
    },
    [handleSelectAction, handleSelectAgent, handleSelectFile],
  );

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    handleSelectItemRef.current = handleSelectItem;
  }, [handleSelectItem]);

  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (!open) {
      setQuery("");
      setActiveIndex(0);

      if (prevOpen && !didNavigateRef.current) {
        const el = takeCommandCenterFocusRestoreElement();
        const isFocused = () =>
          Boolean(el) && typeof document !== "undefined" && document.activeElement === el;

        const cancel = focusWithRetries({
          focus: () => el?.focus(),
          isFocused,
          onTimeout: () => {
            keyboardActionDispatcher.dispatch({
              id: "message-input.focus",
              scope: "message-input",
            });
          },
        });
        return cancel;
      }

      return;
    }

    didNavigateRef.current = false;

    const id = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex >= items.length) {
      setActiveIndex(items.length > 0 ? items.length - 1 : 0);
    }
  }, [activeIndex, items.length, open]);

  const handleKeyEvent = useCallback(
    (key: string): boolean => {
      if (!open) return false;
      const currentItems = itemsRef.current;

      if (key === "Escape") {
        handleCloseRef.current();
        return true;
      }

      if (key === "Enter") {
        if (currentItems.length === 0) return false;
        const index = Math.max(0, Math.min(activeIndexRef.current, currentItems.length - 1));
        handleSelectItemRef.current(currentItems[index]);
        return true;
      }

      if (key === "ArrowDown" || key === "ArrowUp") {
        if (currentItems.length === 0) return false;
        setActiveIndex((current) => {
          const delta = key === "ArrowDown" ? 1 : -1;
          const next = current + delta;
          if (next < 0) return currentItems.length - 1;
          if (next >= currentItems.length) return 0;
          return next;
        });
        return true;
      }

      return false;
    },
    [open],
  );

  useEffect(() => {
    if (!open || !isWeb) return;

    const handler = (event: KeyboardEvent) => {
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Enter" &&
        event.key !== "Escape"
      ) {
        return;
      }
      if (handleKeyEvent(event.key)) {
        event.preventDefault();
      }
    };

    // react-native-web can stop propagation on key events, so listen in capture phase.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, handleKeyEvent]);

  return {
    open,
    inputRef,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    items,
    handleClose,
    handleSelectItem,
    handleKeyEvent,
  };
}
