import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "@/stores/create-flow-store";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  navigateToPreparedWorkspaceTab as navigateToPreparedWorkspaceTabPure,
  resolveWorkspaceDraftOpenTarget as resolveWorkspaceDraftOpenTargetPure,
  type PrepareWorkspaceTabInput,
  type NavigateToPreparedWorkspaceTabInput,
  type ResolveWorkspaceDraftOpenTargetInput,
  type WorkspaceDraftBusyInput,
} from "./prepare-workspace-tab";

export type {
  PrepareWorkspaceTabInput,
  NavigateToPreparedWorkspaceTabInput,
  ResolveWorkspaceDraftOpenTargetInput,
} from "./prepare-workspace-tab";

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

function draftDeps() {
  const draftStore = useDraftStore.getState();
  return {
    getDraftInput: draftStore.getDraftInput,
    isDraftBusy: isWorkspaceDraftBusy,
  };
}

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTabFocused: store.openTabFocused,
    pinAgent: store.pinAgent,
    getWorkspaceTabs: store.getWorkspaceTabs,
    ...draftDeps(),
  };
}

export function resolveWorkspaceDraftOpenTargetFromStores(
  input: Omit<ResolveWorkspaceDraftOpenTargetInput, "getDraftInput" | "isDraftBusy">,
) {
  return resolveWorkspaceDraftOpenTargetPure({
    ...input,
    ...draftDeps(),
  });
}

export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): string {
  return prepareWorkspaceTabPure(input, layoutStoreDeps());
}

export function navigateToPreparedWorkspaceTab(input: NavigateToPreparedWorkspaceTabInput): string {
  return navigateToPreparedWorkspaceTabPure(input, {
    ...layoutStoreDeps(),
    navigateToWorkspace,
  });
}
