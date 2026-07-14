import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import {
  createLastWorkspaceSelectionStore,
  LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "@/stores/last-workspace-selection";
import {
  navigateToLastWorkspace as navigateToLastWorkspacePure,
  navigateToWorkspace as navigateToWorkspacePure,
  parseActiveWorkspaceSelection,
  type NavigateToWorkspaceInput,
  type NavigateToWorkspaceDeps,
} from "./navigation";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import type { WorkspaceDraftBusyInput } from "@/utils/prepare-workspace-tab";

export type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
export type { NavigateToWorkspaceInput } from "./navigation";

const lastWorkspaceSelectionStorage: LastWorkspaceSelectionStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY, value),
};

const lastWorkspaceSelectionStore = createLastWorkspaceSelectionStore(
  lastWorkspaceSelectionStorage,
);

function isWorkspaceDraftBusy(input: WorkspaceDraftBusyInput): boolean {
  const createFlowPending = useCreateFlowStore.getState().pendingByDraftId[input.draftId];
  if (
    isActiveCreateFlowForDraft({
      pending: createFlowPending,
      serverId: input.serverId,
      draftId: input.draftId,
    })
  ) {
    return true;
  }

  const workspaceDraftPending =
    useWorkspaceDraftSubmissionStore.getState().pendingByDraftId[input.draftId];
  return Boolean(
    workspaceDraftPending &&
    workspaceDraftPending.serverId === input.serverId &&
    workspaceDraftPending.workspaceId === input.workspaceId,
  );
}

function navigateDeps(): NavigateToWorkspaceDeps {
  const layoutStore = useWorkspaceLayoutStore.getState();
  const draftStore = useDraftStore.getState();
  return {
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    getSessionAgents: (serverId) =>
      useSessionStore.getState().sessions[serverId]?.agents.values() ?? [],
    openTabFocused: (workspaceKey, target) => layoutStore.openTabFocused(workspaceKey, target),
    pinAgent: (workspaceKey, agentId) => layoutStore.pinAgent(workspaceKey, agentId),
    getWorkspaceTabs: (workspaceKey) => layoutStore.getWorkspaceTabs(workspaceKey),
    getDraftInput: draftStore.getDraftInput,
    isDraftBusy: isWorkspaceDraftBusy,
    rememberLastWorkspace: (selection) => lastWorkspaceSelectionStore.remember(selection),
    navigateToRoute: (route) => {
      navigateToHostWorkspaceRoute(route);
      stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
    },
  };
}

export function hydrateLastWorkspaceSelection(): Promise<void> {
  return lastWorkspaceSelectionStore.hydrate();
}

export function getLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return lastWorkspaceSelectionStore.getSelection();
}

export function getIsLastWorkspaceSelectionHydrated(): boolean {
  return lastWorkspaceSelectionStore.isHydrated();
}

export function navigateToWorkspace(input: NavigateToWorkspaceInput): string {
  return navigateToWorkspacePure(input, navigateDeps());
}

export function navigateToLastWorkspace(): boolean {
  return navigateToLastWorkspacePure({
    ...navigateDeps(),
    getLastWorkspaceSelection: () => lastWorkspaceSelectionStore.getSelection(),
  });
}

export function useActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params });
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    lastWorkspaceSelectionStore.remember({ serverId, workspaceId });
  }, [serverId, workspaceId]);
  return selection;
}

export function useLastWorkspaceSelection(): ActiveWorkspaceSelection | null {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getLastWorkspaceSelection,
    getLastWorkspaceSelection,
  );
}

export function useIsLastWorkspaceSelectionHydrated(): boolean {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getIsLastWorkspaceSelectionHydrated,
    getIsLastWorkspaceSelectionHydrated,
  );
}

void hydrateLastWorkspaceSelection();
