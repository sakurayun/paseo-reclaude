import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { AgentHistoryUnavailableHost } from "@/hooks/use-agent-history";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { AGENT_TRANSCRIPT_EXPORT_MAX_BYTES } from "@getpaseo/protocol/messages";
import { getChatHistorySourceKey } from "@/attachments/chat-history-identity";

export const MAX_TRANSCRIPT_ATTACHMENTS = 5;
export const MAX_TRANSCRIPT_BYTES = AGENT_TRANSCRIPT_EXPORT_MAX_BYTES;
export const MAX_DRAFT_TRANSCRIPT_BYTES = 384 * 1024;
export const TRANSCRIPT_EXPORT_CONCURRENCY = 2;

export type TranscriptSourceGroupKind = "workspace" | "project" | "repository";

export interface TranscriptSourceGroup {
  kind: TranscriptSourceGroupKind;
  agents: AggregatedAgent[];
}

export interface TranscriptDestination {
  serverId: string;
  workspaceId: string;
  projectKey: string | null;
  remoteUrl: string | null;
}

/**
 * Only warn about failures that can affect this picker. A disconnected host in
 * the global registry may be an unrelated machine or a stale daemon identity,
 * so it cannot be assumed to contain this repository. The destination is known
 * to be relevant, while a history request failure means the host was connected
 * and was actually queried during this picker load.
 */
export function selectTranscriptUnavailableHosts(input: {
  hosts: readonly AgentHistoryUnavailableHost[];
  destinationServerId: string;
}): AgentHistoryUnavailableHost[] {
  return input.hosts.filter(
    (host) => host.serverId === input.destinationServerId || host.reason === "history_failed",
  );
}

export interface TranscriptPickerState {
  query: string;
  selection: readonly string[];
  errorsBySource: Readonly<Record<string, string>>;
  selectionError: string | null;
  isAdding: boolean;
  searchResetKey: number;
}

export const INITIAL_TRANSCRIPT_PICKER_STATE: TranscriptPickerState = {
  query: "",
  selection: [],
  errorsBySource: {},
  selectionError: null,
  isAdding: false,
  searchResetKey: 0,
};

export type TranscriptPickerAction =
  | { type: "set_query"; query: string }
  | {
      type: "toggle_source";
      key: string;
      existingSourceKeys: ReadonlySet<string>;
      maximumError: string;
    }
  | { type: "start_add" }
  | {
      type: "finish_add";
      errorsBySource: Readonly<Record<string, string>>;
      successfulKeys: ReadonlySet<string>;
    }
  | { type: "reset" };

export function reduceTranscriptPickerState(
  state: TranscriptPickerState,
  action: TranscriptPickerAction,
): TranscriptPickerState {
  if (action.type === "set_query") {
    return { ...state, query: action.query };
  }
  if (action.type === "reset") {
    return {
      ...INITIAL_TRANSCRIPT_PICKER_STATE,
      searchResetKey: state.searchResetKey + 1,
    };
  }
  if (action.type === "start_add") {
    return {
      ...state,
      isAdding: true,
      errorsBySource: {},
      selectionError: null,
    };
  }
  if (action.type === "finish_add") {
    return {
      ...state,
      isAdding: false,
      errorsBySource: action.errorsBySource,
      selection: state.selection.filter((key) => !action.successfulKeys.has(key)),
    };
  }

  const key = action.key;
  if (state.selection.includes(key)) {
    const errorsBySource = { ...state.errorsBySource };
    delete errorsBySource[key];
    return {
      ...state,
      selection: state.selection.filter((selectedKey) => selectedKey !== key),
      errorsBySource,
      selectionError: null,
    };
  }

  const selectedNewSourceCount = state.selection.filter(
    (selectedKey) => !action.existingSourceKeys.has(selectedKey),
  ).length;
  if (
    !action.existingSourceKeys.has(key) &&
    action.existingSourceKeys.size + selectedNewSourceCount >= MAX_TRANSCRIPT_ATTACHMENTS
  ) {
    return { ...state, selectionError: action.maximumError };
  }
  return {
    ...state,
    selection: [...state.selection, key],
    selectionError: null,
  };
}

export interface TranscriptByteCandidate {
  key: string;
  byteCount: number;
}

/**
 * Applies size-reducing refreshes before additions so click order cannot reject
 * an otherwise valid selection. Size-increasing refreshes and new sources keep
 * selection order for deterministic admission.
 */
export function selectTranscriptCandidatesWithinLimit(input: {
  existingByteCountBySource: ReadonlyMap<string, number>;
  candidates: readonly TranscriptByteCandidate[];
  maxBytes: number;
}): { acceptedKeys: Set<string>; rejectedKeys: Set<string> } {
  const byteCountBySource = new Map(input.existingByteCountBySource);
  let totalBytes = [...byteCountBySource.values()].reduce((sum, bytes) => sum + bytes, 0);
  const acceptedKeys = new Set<string>();
  const rejectedKeys = new Set<string>();

  for (const candidate of input.candidates) {
    const previousByteCount = byteCountBySource.get(candidate.key);
    if (previousByteCount === undefined || candidate.byteCount > previousByteCount) {
      continue;
    }
    totalBytes = totalBytes - previousByteCount + candidate.byteCount;
    byteCountBySource.set(candidate.key, candidate.byteCount);
    acceptedKeys.add(candidate.key);
  }

  for (const candidate of input.candidates) {
    if (acceptedKeys.has(candidate.key)) {
      continue;
    }
    const previousByteCount = byteCountBySource.get(candidate.key) ?? 0;
    const prospectiveTotal = totalBytes - previousByteCount + candidate.byteCount;
    if (prospectiveTotal > input.maxBytes) {
      rejectedKeys.add(candidate.key);
      continue;
    }
    totalBytes = prospectiveTotal;
    byteCountBySource.set(candidate.key, candidate.byteCount);
    acceptedKeys.add(candidate.key);
  }

  return { acceptedKeys, rejectedKeys };
}

export function getTranscriptSourceKey(agent: Pick<AggregatedAgent, "serverId" | "id">): string {
  return getChatHistorySourceKey({ serverId: agent.serverId, agentId: agent.id });
}

export function getGitRemoteIdentity(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) {
    return null;
  }
  const location = parseGitRemoteLocation(remoteUrl);
  if (!location) {
    return null;
  }
  const authority = location.port ? `${location.host}:${location.port}` : location.host;
  return `${authority}/${location.path}`;
}

function compareByLatestActivity(left: AggregatedAgent, right: AggregatedAgent): number {
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

function searchableAgentText(agent: AggregatedAgent): string {
  return [
    agent.title,
    agent.cwd,
    agent.provider,
    agent.serverLabel,
    agent.projectPlacement?.projectName,
    agent.projectPlacement?.workspaceName,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLocaleLowerCase();
}

function matchesSearch(agent: AggregatedAgent, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery.length === 0 || searchableAgentText(agent).includes(normalizedQuery);
}

function sourceRemoteIdentity(agent: AggregatedAgent): string | null {
  return getGitRemoteIdentity(agent.projectPlacement?.checkout.remoteUrl);
}

/**
 * Orders a source into the most-specific destination bucket. Project IDs and
 * paths are intentionally never compared across hosts; only a normalized git
 * remote can establish cross-host repository identity.
 */
export function buildTranscriptSourceGroups(input: {
  agents: readonly AggregatedAgent[];
  destination: TranscriptDestination;
  query: string;
}): TranscriptSourceGroup[] {
  const workspace: AggregatedAgent[] = [];
  const project: AggregatedAgent[] = [];
  const repository: AggregatedAgent[] = [];
  const destinationRemoteIdentity = getGitRemoteIdentity(input.destination.remoteUrl);
  const seen = new Set<string>();

  for (const agent of input.agents) {
    const sourceKey = getTranscriptSourceKey(agent);
    if (
      agent.archivedAt ||
      isDelegatedAgent(agent) ||
      seen.has(sourceKey) ||
      !matchesSearch(agent, input.query)
    ) {
      continue;
    }
    seen.add(sourceKey);

    if (
      agent.serverId === input.destination.serverId &&
      agent.workspaceId === input.destination.workspaceId
    ) {
      workspace.push(agent);
      continue;
    }

    if (
      agent.serverId === input.destination.serverId &&
      input.destination.projectKey !== null &&
      agent.projectPlacement?.projectKey === input.destination.projectKey
    ) {
      project.push(agent);
      continue;
    }

    if (
      destinationRemoteIdentity !== null &&
      sourceRemoteIdentity(agent) === destinationRemoteIdentity
    ) {
      repository.push(agent);
    }
  }

  const groups: TranscriptSourceGroup[] = [
    { kind: "workspace", agents: workspace },
    { kind: "project", agents: project },
    { kind: "repository", agents: repository },
  ];
  return groups
    .filter((group) => group.agents.length > 0)
    .map(
      (group): TranscriptSourceGroup => ({
        kind: group.kind,
        agents: [...group.agents].sort(compareByLatestActivity),
      }),
    );
}

export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Runs source exports with a small fixed concurrency limit while preserving input order. */
export async function settleWithConcurrency<T, Result>(input: {
  values: readonly T[];
  limit: number;
  task: (value: T, index: number) => Promise<Result>;
}): Promise<PromiseSettledResult<Result>[]> {
  const limit = Math.max(1, Math.floor(input.limit));
  const results: Array<PromiseSettledResult<Result> | undefined> = Array.from({
    length: input.values.length,
  });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < input.values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await input.task(input.values[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, input.values.length) }, () => worker()));
  return results.filter((result): result is PromiseSettledResult<Result> => result !== undefined);
}
