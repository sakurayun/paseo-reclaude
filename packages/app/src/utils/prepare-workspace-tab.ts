import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import type { DraftInput } from "@/stores/draft-store";
import { hasDraftInputContent } from "@/stores/draft-store/state";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceTab,
  type WorkspaceTabTarget,
} from "@/stores/workspace-tabs-store";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

export interface PrepareWorkspaceTabInput {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  pin?: boolean;
}

export interface NavigateToPreparedWorkspaceTabInput extends PrepareWorkspaceTabInput {
  currentPathname?: string | null;
}

export interface PrepareWorkspaceTabDeps {
  openTabFocused: (workspaceKey: string, target: WorkspaceTabTarget) => string | null;
  pinAgent: (workspaceKey: string, agentId: string) => void;
  getWorkspaceTabs?: (workspaceKey: string) => WorkspaceTab[];
  getDraftInput?: (draftKey: string) => DraftInput | undefined;
  isDraftBusy?: (input: WorkspaceDraftBusyInput) => boolean;
  createDraftId?: () => string;
}

export interface NavigateToPreparedWorkspaceTabDeps extends PrepareWorkspaceTabDeps {
  navigateToWorkspace: (
    serverId: string,
    workspaceId: string,
    options: { currentPathname?: string | null },
  ) => void;
}

export interface WorkspaceDraftBusyInput {
  serverId: string;
  workspaceId: string;
  draftId: string;
}

type WorkspaceDraftTabTarget = Extract<WorkspaceTabTarget, { kind: "draft" }>;

export interface ResolveWorkspaceDraftOpenTargetInput {
  serverId: string;
  workspaceId: string;
  requestedTarget: WorkspaceDraftTabTarget;
  tabs: readonly WorkspaceTab[];
  getDraftInput: (draftKey: string) => DraftInput | undefined;
  isDraftBusy?: (input: WorkspaceDraftBusyInput) => boolean;
  createDraftId?: () => string;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function canReuseDraftTab(input: {
  serverId: string;
  workspaceId: string;
  tab: WorkspaceTab;
  getDraftInput: (draftKey: string) => DraftInput | undefined;
  isDraftBusy?: (input: WorkspaceDraftBusyInput) => boolean;
}): boolean {
  const { target } = input.tab;
  if (target.kind !== "draft" || target.setup) {
    return false;
  }
  if (
    input.isDraftBusy?.({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      draftId: target.draftId,
    })
  ) {
    return false;
  }

  const draftKey = buildDraftStoreKey({
    serverId: input.serverId,
    agentId: input.tab.tabId,
    draftId: target.draftId,
  });
  const draft = input.getDraftInput(draftKey);
  return !draft || !hasDraftInputContent(draft);
}

function findReusableDraftTab(input: {
  serverId: string;
  workspaceId: string;
  tabs: readonly WorkspaceTab[];
  getDraftInput: (draftKey: string) => DraftInput | undefined;
  isDraftBusy?: (input: WorkspaceDraftBusyInput) => boolean;
}): WorkspaceDraftTabTarget | null {
  for (const tab of input.tabs) {
    if (canReuseDraftTab({ ...input, tab }) && tab.target.kind === "draft") {
      return tab.target;
    }
  }
  return null;
}

export function resolveWorkspaceDraftOpenTarget(
  input: ResolveWorkspaceDraftOpenTargetInput,
): WorkspaceDraftTabTarget {
  const requestedDraftId = trimNonEmpty(input.requestedTarget.draftId);
  if (requestedDraftId && requestedDraftId !== "new") {
    return input.requestedTarget;
  }

  if (!input.requestedTarget.setup) {
    const reusableTarget = findReusableDraftTab(input);
    if (reusableTarget) {
      return reusableTarget;
    }
  }

  const draftId = (input.createDraftId ?? generateDraftId)();
  return input.requestedTarget.setup
    ? { kind: "draft", draftId, setup: input.requestedTarget.setup }
    : { kind: "draft", draftId };
}

function getPreparedTarget(input: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  target: WorkspaceTabTarget;
  deps: PrepareWorkspaceTabDeps;
}): WorkspaceTabTarget {
  if (input.target.kind !== "draft" || input.target.draftId.trim() !== "new") {
    return input.target;
  }

  return resolveWorkspaceDraftOpenTarget({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    requestedTarget: input.target,
    tabs: input.deps.getWorkspaceTabs?.(input.workspaceKey) ?? [],
    getDraftInput: input.deps.getDraftInput ?? (() => undefined),
    isDraftBusy: input.deps.isDraftBusy,
    createDraftId: input.deps.createDraftId,
  });
}

export function prepareWorkspaceTab(
  input: PrepareWorkspaceTabInput,
  deps: PrepareWorkspaceTabDeps,
): string {
  const key =
    buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    }) ?? "";
  const target = getPreparedTarget({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    workspaceKey: key,
    target: input.target,
    deps,
  });

  deps.openTabFocused(key, target);

  if (input.pin && target.kind === "agent") {
    deps.pinAgent(key, target.agentId);
  }

  return buildHostWorkspaceRoute(input.serverId, input.workspaceId);
}

export function navigateToPreparedWorkspaceTab(
  input: NavigateToPreparedWorkspaceTabInput,
  deps: NavigateToPreparedWorkspaceTabDeps,
): string {
  const route = prepareWorkspaceTab(input, deps);
  deps.navigateToWorkspace(input.serverId, input.workspaceId, {
    currentPathname: input.currentPathname,
  });
  return route;
}
