import { useCallback, useEffect, useMemo } from "react";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useHydratedWorkspaceServerIds } from "@/stores/session-store-hooks";
import { useHostProjects } from "@/projects/host-projects";
import { fetchAllWorkspaceDescriptors } from "@/projects/workspace-fetching";
import { getHostRuntimeStore, useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { shouldSuppressWorkspaceForLocalArchive } from "@/contexts/session-workspace-upserts";
import {
  buildSidebarWorkspacePlacementModel,
  computeSidebarOrderUpdates,
  deriveSidebarLoadingState,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "./sidebar-workspaces-view-model";

export {
  appendMissingOrderKeys,
  applyStoredOrdering,
  buildSidebarProjectsFromHostProjects,
  buildSidebarProjectsFromStructure,
  createSidebarWorkspaceEntry,
  buildSidebarWorkspacePlacementModel,
  computeSidebarOrderUpdates,
  deriveSidebarLoadingState,
  shouldShowSidebarHostLabels,
  type SidebarLoadingState,
  type SidebarOrderUpdates,
  type SidebarStatusWorkspacePlacement,
  type SidebarWorkspacePlacement,
  type SidebarWorkspacePlacementModel,
  type SidebarProjectEntry,
  type SidebarStateBucket,
  type SidebarWorkspaceEntry,
} from "./sidebar-workspaces-view-model";

const EMPTY_ORDER: string[] = [];
const EMPTY_PROJECTS: SidebarProjectEntry[] = [];
const EMPTY_WORKSPACES: SidebarWorkspacePlacement[] = [];
const EMPTY_PROJECT_NAMES = new Map<string, string>();

export interface SidebarWorkspacesListResult {
  workspacePlacements: SidebarWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByKey: Map<string, string>;
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

function filterBySearchQuery(
  projects: SidebarProjectEntry[],
  query: string,
): SidebarProjectEntry[] {
  if (!query.trim()) {
    return projects;
  }

  const lowerQuery = query.toLowerCase().trim();

  return projects
    .map((project) => {
      const projectNameMatch = project.projectName.toLowerCase().includes(lowerQuery);
      const iconDirMatch = project.iconWorkingDir.toLowerCase().includes(lowerQuery);

      // If the project name or working directory matches, show the whole project
      if (projectNameMatch || iconDirMatch) {
        return project;
      }

      // Otherwise, check if any workspace matches
      const matchingWorkspaces = project.workspaces.filter((workspace) => {
        const nameMatch = workspace.name.toLowerCase().includes(lowerQuery);
        const dirMatch = workspace.workspaceDirectory?.toLowerCase().includes(lowerQuery) ?? false;
        const rootMatch = workspace.projectRootPath?.toLowerCase().includes(lowerQuery) ?? false;
        return nameMatch || dirMatch || rootMatch;
      });

      if (matchingWorkspaces.length === 0) {
        return null;
      }

      return {
        ...project,
        workspaces: matchingWorkspaces,
      };
    })
    .filter((project): project is SidebarProjectEntry => project !== null);
}

export function useSidebarWorkspacesList(options?: {
  hostFilters?: string[];
  searchQuery?: string;
  enabled?: boolean;
}): SidebarWorkspacesListResult {
  const runtime = getHostRuntimeStore();
  const allHosts = useHosts();
  const hostRegistryLoaded = useHostRegistryLoaded();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);

  const storeHostFilters = useSidebarViewStore((state) => state.hostFilters);
  const storeSearchQuery = useSidebarViewStore((state) => state.searchQuery);
  const hostFilters = options?.hostFilters ?? storeHostFilters;
  const searchQuery = options?.searchQuery ?? storeSearchQuery;
  const reconcileHostFilters = useSidebarViewStore((state) => state.reconcileHostFilters);
  const effectiveHostFilters =
    hostFilters.length > 0 && hostRegistryLoaded
      ? hostFilters.filter((serverId) => allServerIds.includes(serverId))
      : hostFilters;
  const isActive = options?.enabled !== false;

  const serverIds = useMemo(() => {
    if (effectiveHostFilters.length > 0) {
      const selected = new Set(effectiveHostFilters);
      return allServerIds.filter((id) => selected.has(id));
    }
    return allServerIds;
  }, [allServerIds, effectiveHostFilters]);

  useEffect(() => {
    if (!hostRegistryLoaded) {
      return;
    }
    reconcileHostFilters(allServerIds);
  }, [allServerIds, hostRegistryLoaded, reconcileHostFilters]);

  const persistedProjectOrder = useSidebarOrderStore((state) => state.projectOrder ?? EMPTY_ORDER);

  const hydratedServerIds = useHydratedWorkspaceServerIds(serverIds);

  const hostProjects = useHostProjects(hydratedServerIds);

  const sidebarModel = useMemo(
    () =>
      buildSidebarWorkspacePlacementModel({
        projects: hostProjects,
      }),
    [hostProjects],
  );

  const rawProjects = sidebarModel.projects.length > 0 ? sidebarModel.projects : EMPTY_PROJECTS;
  const projects = useMemo(
    () => filterBySearchQuery(rawProjects, searchQuery),
    [rawProjects, searchQuery],
  );
  const workspacePlacements = useMemo(
    () => (projects.length > 0 ? projects.flatMap((p) => p.workspaces) : EMPTY_WORKSPACES),
    [projects],
  );
  const projectNamesByKey = useMemo(
    () =>
      projects.length > 0
        ? new Map(projects.map((p) => [p.projectKey, p.projectName]))
        : EMPTY_PROJECT_NAMES,
    [projects],
  );

  useEffect(() => {
    const orderStore = useSidebarOrderStore.getState();
    const updates = computeSidebarOrderUpdates({
      projects,
      persistedProjectOrder,
      getWorkspaceOrder: (projectKey) =>
        orderStore.workspaceOrderByProject[projectKey] ?? EMPTY_ORDER,
    });

    if (updates.projectOrder) {
      orderStore.setProjectOrder(updates.projectOrder);
    }
    for (const { projectKey, order } of updates.workspaceOrders) {
      orderStore.setWorkspaceOrder(projectKey, order);
    }
  }, [persistedProjectOrder, projects]);

  const refreshAll = useCallback(() => {
    if (!isActive) return;
    for (const serverId of serverIds) {
      const snapshot = runtime.getSnapshot(serverId);
      if (snapshot?.connectionStatus !== "online") continue;
      const client = runtime.getClient(serverId);
      if (!client) continue;
      void (async () => {
        const next = new Map<string, WorkspaceDescriptor>();
        try {
          const { workspaces, emptyProjects } = await fetchAllWorkspaceDescriptors({
            client,
            sort: [{ key: "activity_at", direction: "desc" }],
          });
          for (const workspace of workspaces) {
            if (shouldSuppressWorkspaceForLocalArchive({ serverId, workspace })) {
              continue;
            }
            next.set(workspace.id, workspace);
          }
          const store = useSessionStore.getState();
          store.setWorkspaces(serverId, next);
          // Keep parents with no workspaces yet, so a manual refresh doesn't drop
          // a freshly-added project from the sidebar.
          store.setEmptyProjects(serverId, emptyProjects);
          store.setHasHydratedWorkspaces(serverId, true);
        } catch (error) {
          console.error("[WorkspaceFetch][sidebar-refresh] failed", {
            serverId,
            error,
          });
          // ignore explicit refresh failures; hook keeps existing data
        }
      })();
    }
  }, [isActive, runtime, serverIds]);

  const loadingState = deriveSidebarLoadingState({
    isActive,
    serverIds,
    hydratedServerIds,
    hasProjects: projects.length > 0,
  });

  return {
    workspacePlacements,
    projects,
    projectNamesByKey,
    ...loadingState,
    refreshAll,
  };
}
