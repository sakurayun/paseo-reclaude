import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TextInput } from "react-native";
import { router, usePathname, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import {
  clearCommandCenterFocusRestoreElement,
  takeCommandCenterFocusRestoreElement,
} from "@/utils/command-center-focus-restore";
import {
  buildOpenProjectRoute,
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
import { isWeb } from "@/constants/platform";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import type {
  DirectorySuggestionsResponse,
  SessionContentMatch,
  WorkspaceFileMatch,
} from "@getpaseo/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { useSessionSearchFocusStore } from "@/stores/session-search-focus-store";
import { useProjects } from "@/hooks/use-projects";
import {
  navigateToWorkspace,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import {
  useFocusedDraftControllerStore,
  type FocusedDraftController,
} from "@/stores/focused-draft-controller-store";
import { useShallow } from "zustand/shallow";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveAgentModelSelection } from "@/composer/agent-controls/utils";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";

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

const EMPTY_ACTION_ITEMS: CommandCenterActionItem[] = [];
const EMPTY_FILE_ITEMS: CommandCenterFileItem[] = [];
const EMPTY_WORKSPACE_ITEMS: CommandCenterWorkspaceItem[] = [];
const EMPTY_AGENT_ITEMS: CommandCenterAgentItem[] = [];
const EMPTY_COMMAND_CENTER_ITEMS: CommandCenterItem[] = [];
const EMPTY_MESSAGE_ITEMS: CommandCenterMessageItem[] = [];
const EMPTY_FILE_CONTENT_ITEMS: CommandCenterFileContentItem[] = [];

function buildSearchText(...fields: string[]): string {
  return fields.join(" ").toLowerCase();
}

function matchesQuery(searchText: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || searchText.includes(normalized);
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
    | "shell.commandCenter.addProject"
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
    titleKey: "shell.commandCenter.addProject",
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

export interface CommandCenterActionItem {
  kind: "action";
  id: string;
  title: string;
  icon?: "plus" | "settings" | "home";
  route?: Href;
  shortcutKeys?: ShortcutKey[][];
  searchText: string;
}

export interface CommandCenterWorkspaceItem {
  kind: "workspace";
  serverId: string;
  workspaceId: string;
  title: string;
  subtitle: string;
  searchText: string;
}

export interface CommandCenterAgentItem {
  kind: "agent";
  agent: AggregatedAgent;
  title: string;
  subtitle: string;
  searchText: string;
}

type CommandCenterFileItem = CommandCenterFileMatch & {
  workspaceId: string;
  serverId: string;
};

export interface CommandCenterMessageItem {
  match: SessionContentMatch;
  serverId: string;
}

export interface CommandCenterFileContentItem {
  match: WorkspaceFileMatch;
  serverId: string;
}

export interface CommandCenterModelItem {
  kind: "model";
  /** "agent": switch a running agent's model. "draft": pick provider+model for a new tab. */
  source: "agent" | "draft";
  serverId: string;
  /** Present for the "agent" source; null for a draft (handled via the focused-draft store). */
  agentId: string | null;
  provider: AgentProvider;
  modelId: string;
  /** Breadcrumb top segment shown muted, e.g. "Model". */
  groupLabel: string;
  /** Breadcrumb middle segment shown muted, e.g. "Claude". */
  providerLabel: string;
  /** Breadcrumb leaf (the model label), highlighted, e.g. "Opus 4.8". */
  title: string;
  isActive: boolean;
  searchText: string;
}

export type CommandCenterItem =
  | CommandCenterActionItem
  | CommandCenterWorkspaceItem
  | CommandCenterAgentItem
  | CommandCenterModelItem
  | {
      kind: "file";
      file: CommandCenterFileItem;
    }
  | {
      kind: "message";
      message: CommandCenterMessageItem;
    }
  | {
      kind: "file-content";
      fileContent: CommandCenterFileContentItem;
    };

const EMPTY_MODEL_ITEMS: CommandCenterModelItem[] = [];

interface ModelRowContext {
  serverId: string;
  groupLabel: string;
  keywords: string;
}

function buildModelItem(
  ctx: ModelRowContext,
  input: {
    source: "agent" | "draft";
    agentId: string | null;
    provider: AgentProvider;
    providerLabel: string;
    model: AgentModelDefinition;
    isActive: boolean;
  },
): CommandCenterModelItem {
  return {
    kind: "model",
    source: input.source,
    serverId: ctx.serverId,
    agentId: input.agentId,
    provider: input.provider,
    modelId: input.model.id,
    groupLabel: ctx.groupLabel,
    providerLabel: input.providerLabel,
    title: input.model.label,
    isActive: input.isActive,
    searchText: buildSearchText(
      ctx.groupLabel,
      input.providerLabel,
      input.model.label,
      input.model.id,
      ctx.keywords,
    ),
  };
}

interface ModelAgentSlice {
  provider: AgentProvider;
  runtimeModelId: string | null;
  model: string | null;
  thinkingOptionId: string | null | undefined;
}

// Running agent: only its own provider's models (a live agent can't change provider).
function buildAgentModelRows(
  ctx: ModelRowContext,
  input: { agentId: string; slice: ModelAgentSlice; entries: ProviderSnapshotEntry[] | undefined },
): CommandCenterModelItem[] {
  const entry = input.entries?.find((e) => e.provider === input.slice.provider) ?? null;
  const models = entry?.models ?? null;
  if (!models || models.length === 0) return [];
  const providerLabel = entry?.label ?? input.slice.provider;
  const { activeModelId } = resolveAgentModelSelection({
    models,
    runtimeModelId: input.slice.runtimeModelId,
    configuredModelId: input.slice.model,
    explicitThinkingOptionId: input.slice.thinkingOptionId,
  });
  return models.map((model) =>
    buildModelItem(ctx, {
      source: "agent",
      agentId: input.agentId,
      provider: input.slice.provider,
      providerLabel,
      model,
      isActive: model.id === activeModelId,
    }),
  );
}

// New draft tab: every available provider's models flattened into one list.
function buildDraftModelRows(
  ctx: ModelRowContext,
  input: { draft: FocusedDraftController; entries: ProviderSnapshotEntry[] | undefined },
): CommandCenterModelItem[] {
  const rows: CommandCenterModelItem[] = [];
  for (const entry of input.entries ?? []) {
    const models = entry.models ?? [];
    if (models.length === 0) continue;
    const providerLabel = entry.label ?? entry.provider;
    for (const model of models) {
      rows.push(
        buildModelItem(ctx, {
          source: "draft",
          agentId: null,
          provider: entry.provider,
          providerLabel,
          model,
          isActive:
            input.draft.provider === entry.provider && input.draft.selectedModelId === model.id,
        }),
      );
    }
  }
  return rows;
}

/**
 * Model rows for Command-K: either the focused live agent's models, or every
 * available provider's models for a focused draft. Extracted so useCommandCenter
 * stays under the complexity cap.
 */
function useCommandCenterModelResults(input: { open: boolean; query: string }): {
  modelResults: CommandCenterModelItem[];
  handleSelectModel: (item: CommandCenterModelItem) => void;
} {
  const { t } = useTranslation();
  const { open, query } = input;
  const setOpen = useKeyboardShortcutsStore((s) => s.setCommandCenterOpen);
  const toast = useToast();
  const { updatePreferences } = useFormPreferences();

  // Active agent (the focused pane's agent of the active workspace). Read from global
  // zustand singletons — SessionContext is not an ancestor of the CommandCenter.
  const focusedSelection = useLastWorkspaceSelection();
  const focusedServerId = focusedSelection?.serverId ?? null;
  const focusedAgentId = useSessionStore((state) =>
    focusedServerId ? (state.sessions[focusedServerId]?.focusedAgentId ?? null) : null,
  );
  const focusedClient = useSessionStore((state) =>
    focusedServerId ? (state.sessions[focusedServerId]?.client ?? null) : null,
  );
  const focusedAgentSlice = useSessionStore(
    useShallow((state) => {
      if (!focusedServerId || !focusedAgentId) return null;
      const agent = state.sessions[focusedServerId]?.agents?.get(focusedAgentId);
      if (!agent) return null;
      return {
        provider: agent.provider,
        cwd: agent.cwd,
        runtimeModelId: agent.runtimeInfo?.model ?? null,
        model: agent.model,
        thinkingOptionId: agent.thinkingOptionId,
      };
    }),
  );

  // A running agent takes priority; otherwise a focused draft (new tab) contributes the
  // "pick provider + model" list. The draft publishes its controller globally (see store).
  const draftController = useFocusedDraftControllerStore((state) => state.controller);
  const isAgentFocus = Boolean(focusedAgentId && focusedAgentSlice);
  const draftFocus = !isAgentFocus ? draftController : null;

  const modelServerId = isAgentFocus ? focusedServerId : (draftFocus?.serverId ?? null);
  const modelCwd = isAgentFocus ? focusedAgentSlice?.cwd : draftFocus?.cwd;
  const { entries: snapshotEntries } = useProvidersSnapshot(modelServerId, {
    cwd: modelCwd,
    enabled: open && Boolean(modelServerId && (isAgentFocus || draftFocus)),
  });

  const modelResults = useMemo(() => {
    // Only surface models once the user starts typing — keeps the default view clean.
    if (!open || !query.trim() || !modelServerId) {
      return EMPTY_MODEL_ITEMS;
    }
    const ctx: ModelRowContext = {
      serverId: modelServerId,
      groupLabel: t("shell.commandCenter.modelGroupLabel"),
      keywords: t("shell.commandCenter.modelSearchKeywords"),
    };
    let rows: CommandCenterModelItem[];
    if (isAgentFocus && focusedAgentId && focusedAgentSlice) {
      rows = buildAgentModelRows(ctx, {
        agentId: focusedAgentId,
        slice: focusedAgentSlice,
        entries: snapshotEntries,
      });
    } else if (draftFocus) {
      rows = buildDraftModelRows(ctx, { draft: draftFocus, entries: snapshotEntries });
    } else {
      rows = [];
    }
    return rows.filter((item) => matchesQuery(item.searchText, query));
  }, [
    open,
    query,
    modelServerId,
    isAgentFocus,
    focusedAgentId,
    focusedAgentSlice,
    draftFocus,
    snapshotEntries,
    t,
  ]);

  const handleSelectModel = useCallback(
    (item: CommandCenterModelItem) => {
      // Switching a model does not navigate — keep the focus-restore behavior so focus
      // returns to the previously focused element after the palette closes.
      setOpen(false);
      if (item.source === "draft") {
        // Write the choice into the focused draft's live form (sets provider + model).
        useFocusedDraftControllerStore
          .getState()
          .controller?.setProviderAndModel(item.provider, item.modelId);
        return;
      }
      if (item.isActive || !focusedClient || !item.agentId) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: item.provider,
          updates: { model: item.modelId },
        }),
      ).catch((error) => {
        console.warn("[CommandCenter] persist model preference failed", error);
      });
      void focusedClient.setAgentModel(item.agentId, item.modelId).catch((error) => {
        console.warn("[CommandCenter] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [focusedClient, setOpen, toast, updatePreferences],
  );

  return { modelResults, handleSelectModel };
}

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

// Capability-gated global search section (cross-session messages / workspace
// files). Extracted from useCommandCenter to keep that hook's complexity low and
// to share the identical query/gate/empty-state wiring between both sections.
function useGlobalSearchSection<T>(input: {
  feature: "sessionContentSearch" | "workspaceFileSearch";
  queryKey: string;
  open: boolean;
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
  activeServerId: string | null;
  debouncedQuery: string;
  hasQuery: boolean;
  empty: T[];
  fetch: (
    client: NonNullable<ReturnType<typeof useHostRuntimeClient>>,
    serverId: string,
    query: string,
  ) => Promise<T[]>;
}): T[] {
  const { client, activeServerId, debouncedQuery, empty } = input;
  const supported = useSessionStore(
    (state) => state.sessions[activeServerId ?? ""]?.serverInfo?.features?.[input.feature] === true,
  );
  const query = useQuery({
    queryKey: [input.queryKey, activeServerId ?? "", debouncedQuery],
    queryFn: async (): Promise<T[]> => {
      if (!client || !activeServerId) {
        return empty;
      }
      return input.fetch(client, activeServerId, debouncedQuery);
    },
    enabled:
      input.open && Boolean(client) && input.isConnected && supported && debouncedQuery.length > 0,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () => (input.hasQuery ? (query.data ?? empty) : empty),
    [input.hasQuery, query.data, empty],
  );
}

export function useCommandCenter() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { overrides } = useKeyboardShortcutOverrides();
  const open = useKeyboardShortcutsStore((s) => s.commandCenterOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setCommandCenterOpen);
  const openAddProject = useOpenAddProject();
  const inputRef = useRef<TextInput>(null);
  const didNavigateRef = useRef(false);
  const prevOpenRef = useRef(open);
  const activeIndexRef = useRef(0);
  const itemsRef = useRef<CommandCenterItem[]>([]);
  const handleCloseRef = useRef<() => void>(() => undefined);
  const handleSelectItemRef = useRef<(item: CommandCenterItem) => void>(() => undefined);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const { agents } = useAggregatedAgents();
  const { projects } = useProjects({ enabled: open });
  const hosts = useHosts();
  const showAgentHost = hosts.length > 1;
  const { modelResults, handleSelectModel } = useCommandCenterModelResults({ open, query });

  const allWorkspaceItems = useMemo(() => {
    const results: CommandCenterWorkspaceItem[] = [];
    for (const project of projects) {
      for (const host of project.hosts) {
        for (const workspace of host.workspaces) {
          if (workspace.archivingAt) continue;
          const title = workspace.title ?? workspace.name;
          const subtitle = workspace.currentBranch
            ? `${host.serverName} · ${workspace.currentBranch}`
            : host.serverName;
          results.push({
            kind: "workspace",
            serverId: host.serverId,
            workspaceId: workspace.id,
            title,
            subtitle,
            searchText: buildSearchText(title, subtitle),
          });
        }
      }
    }
    results.sort((left, right) => {
      const titleDelta = left.title.localeCompare(right.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (titleDelta !== 0) return titleDelta;
      const hostDelta = left.subtitle.localeCompare(right.subtitle, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (hostDelta !== 0) return hostDelta;
      return `${left.serverId}:${left.workspaceId}`.localeCompare(
        `${right.serverId}:${right.workspaceId}`,
      );
    });
    return results;
  }, [projects]);

  const workspaceTitleByKey = useMemo(
    () =>
      new Map(
        allWorkspaceItems.map((workspace) => [
          `${workspace.serverId}:${workspace.workspaceId}`,
          workspace.title,
        ]),
      ),
    [allWorkspaceItems],
  );

  const workspaceResults = useMemo(() => {
    if (!open || allWorkspaceItems.length === 0) {
      return EMPTY_WORKSPACE_ITEMS;
    }
    return allWorkspaceItems.filter((workspace) => matchesQuery(workspace.searchText, query));
  }, [allWorkspaceItems, open, query]);

  const agentResults = useMemo(() => {
    if (!open || agents.length === 0) {
      return EMPTY_AGENT_ITEMS;
    }
    const items = agents.map<CommandCenterAgentItem>((agent) => {
      const title = agent.title || t("shell.commandCenter.newAgent");
      const workspaceTitle = agent.workspaceId
        ? workspaceTitleByKey.get(`${agent.serverId}:${agent.workspaceId}`)
        : undefined;
      const location = workspaceTitle ?? shortenPath(agent.cwd);
      const subtitle = [
        showAgentHost ? agent.serverLabel : null,
        location,
        formatTimeAgo(agent.lastActivityAt),
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ");
      return {
        kind: "agent",
        agent,
        title,
        subtitle,
        searchText: buildSearchText(title, subtitle, agent.cwd),
      };
    });
    const filtered = items.filter((item) => matchesQuery(item.searchText, query));
    filtered.sort((left, right) => sortAgents(left.agent, right.agent));
    return filtered;
  }, [agents, open, query, showAgentHost, t, workspaceTitleByKey]);

  const searchWorkspace = useMemo(
    () =>
      resolveCommandCenterWorkspaceScope({
        pathname,
        agents,
      }),
    [agents, pathname],
  );
  const activeServerId = open ? (searchWorkspace?.serverId ?? null) : null;
  const client = useHostRuntimeClient(activeServerId ?? "");
  const isConnected = useHostRuntimeIsConnected(activeServerId ?? "");
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

  const messageItems = useGlobalSearchSection<CommandCenterMessageItem>({
    feature: "sessionContentSearch",
    queryKey: "command-center-session-content",
    open,
    client,
    isConnected,
    activeServerId,
    debouncedQuery: debouncedFileQuery,
    hasQuery: trimmedQuery.length > 0,
    empty: EMPTY_MESSAGE_ITEMS,
    fetch: async (resolvedClient, serverId, searchQuery) => {
      const payload = await resolvedClient.searchSessionContent({ query: searchQuery, limit: 30 });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.results.map((match) => ({ match, serverId }));
    },
  });

  const fileContentItems = useGlobalSearchSection<CommandCenterFileContentItem>({
    feature: "workspaceFileSearch",
    queryKey: "command-center-workspace-content",
    open,
    client,
    isConnected,
    activeServerId,
    debouncedQuery: debouncedFileQuery,
    hasQuery: trimmedQuery.length > 0,
    empty: EMPTY_FILE_CONTENT_ITEMS,
    fetch: async (resolvedClient, serverId, searchQuery) => {
      const payload = await resolvedClient.searchWorkspaceFiles({
        query: searchQuery,
        maxResults: 30,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.results.map((match) => ({ match, serverId }));
    },
  });

  const settingsRoute = useMemo<Href>(() => {
    return buildSettingsRoute();
  }, []);

  const homeRoute = useMemo<Href>(() => buildOpenProjectRoute() as Href, []);

  const actionItems = useMemo(() => {
    if (!open) {
      return EMPTY_ACTION_ITEMS;
    }
    return COMMAND_CENTER_ACTIONS.filter(
      (action) => action.routeKind !== "home" || Boolean(homeRoute),
    )
      .map<CommandCenterActionItem>((action) => {
        let route: Href | undefined;
        if (action.routeKind === "settings") route = settingsRoute;
        else if (action.routeKind === "home") route = homeRoute;
        const title = t(action.titleKey);
        return {
          kind: "action",
          id: action.id,
          title,
          icon: action.icon,
          route,
          shortcutKeys: resolveActionShortcutKeys(action.actionId, overrides),
          searchText: buildSearchText(title, ...action.keywords),
        };
      })
      .filter((action) => matchesQuery(action.searchText, query));
  }, [open, query, settingsRoute, homeRoute, overrides, t]);

  const items = useMemo(() => {
    if (!open) {
      return EMPTY_COMMAND_CENTER_ITEMS;
    }
    const next: CommandCenterItem[] = [...actionItems, ...modelResults, ...workspaceResults];
    for (const file of fileItems) {
      next.push({
        kind: "file",
        file,
      });
    }
    next.push(...agentResults);
    for (const message of messageItems) {
      next.push({
        kind: "message",
        message,
      });
    }
    for (const fileContent of fileContentItems) {
      next.push({
        kind: "file-content",
        fileContent,
      });
    }
    return next;
  }, [
    actionItems,
    agentResults,
    fileContentItems,
    fileItems,
    messageItems,
    modelResults,
    open,
    workspaceResults,
  ]);

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
      });
    },
    [setOpen],
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
      });
    },
    [setOpen],
  );

  const handleSelectWorkspace = useCallback(
    (workspace: CommandCenterWorkspaceItem) => {
      didNavigateRef.current = true;
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      navigateToWorkspace({
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
      });
    },
    [setOpen],
  );

  const requestSessionSearchFocus = useSessionSearchFocusStore((state) => state.requestFocus);

  const handleSelectMessage = useCallback(
    (message: CommandCenterMessageItem) => {
      didNavigateRef.current = true;
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      // Queue an in-session find for the target agent, then navigate to it; its
      // AgentStreamView consumes the focus once ready (see session-search-focus-store).
      requestSessionSearchFocus({
        agentId: message.match.agentId,
        query: trimmedQuery,
        itemId: message.match.itemId.length > 0 ? message.match.itemId : undefined,
      });
      navigateToAgent({
        serverId: message.serverId,
        agentId: message.match.agentId,
      });
    },
    [requestSessionSearchFocus, setOpen, trimmedQuery],
  );

  const handleSelectFileContent = useCallback(
    (fileContent: CommandCenterFileContentItem) => {
      didNavigateRef.current = true;
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      navigateToPreparedWorkspaceTab({
        serverId: fileContent.serverId,
        workspaceId: fileContent.match.workspaceId,
        target: {
          kind: "file",
          path: fileContent.match.relPath,
          lineStart: fileContent.match.line,
        },
      });
    },
    [setOpen],
  );

  const handleSelectAction = useCallback(
    (action: CommandCenterActionItem) => {
      clearCommandCenterFocusRestoreElement();
      setOpen(false);
      if (action.id === "new-agent") {
        openAddProject();
        return;
      }
      if (!action.route) {
        return;
      }
      didNavigateRef.current = true;
      router.push(action.route);
    },
    [openAddProject, setOpen],
  );

  const handleSelectItem = useCallback(
    (item: CommandCenterItem) => {
      if (item.kind === "action") {
        handleSelectAction(item);
        return;
      }
      if (item.kind === "workspace") {
        handleSelectWorkspace(item);
        return;
      }
      if (item.kind === "model") {
        handleSelectModel(item);
        return;
      }
      if (item.kind === "file") {
        handleSelectFile(item.file);
        return;
      }
      if (item.kind === "message") {
        handleSelectMessage(item.message);
        return;
      }
      if (item.kind === "file-content") {
        handleSelectFileContent(item.fileContent);
        return;
      }
      handleSelectAgent(item.agent);
    },
    [
      handleSelectAction,
      handleSelectAgent,
      handleSelectFile,
      handleSelectFileContent,
      handleSelectMessage,
      handleSelectModel,
      handleSelectWorkspace,
    ],
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
