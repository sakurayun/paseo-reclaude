import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { normalizeWorkspaceFileLocation, workspaceFileLocationsEqual } from "@/workspace/file-open";

type WorkspaceDraftTabSetup = NonNullable<Extract<WorkspaceTabTarget, { kind: "draft" }>["setup"]>;

/** Tab kind discrimination spans many branches by design. */
// eslint-disable-next-line complexity -- exhaustive tab-kind discrimination
export function normalizeWorkspaceTabTarget(
  value: WorkspaceTabTarget | null | undefined,
): WorkspaceTabTarget | null {
  if (!value || typeof value !== "object" || typeof value.kind !== "string") {
    return null;
  }
  switch (value.kind) {
    case "draft": {
      const draftId = trimNonEmpty(value.draftId);
      if (!draftId) {
        return null;
      }
      const setup = normalizeWorkspaceDraftTabSetup(value.setup);
      return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
    }
    case "agent": {
      const agentId = trimNonEmpty(value.agentId);
      return agentId ? { kind: "agent", agentId } : null;
    }
    case "provider_subagent": {
      const parentAgentId = trimNonEmpty(value.parentAgentId);
      const subagentId = trimNonEmpty(value.subagentId);
      return parentAgentId && subagentId
        ? { kind: "provider_subagent", parentAgentId, subagentId }
        : null;
    }
    case "terminal": {
      const terminalId = trimNonEmpty(value.terminalId);
      return terminalId ? { kind: "terminal", terminalId } : null;
    }
    case "ssh-connecting": {
      const connectId = trimNonEmpty(value.connectId);
      return connectId ? { kind: "ssh-connecting", connectId } : null;
    }
    case "browser": {
      const browserId = trimNonEmpty(value.browserId);
      return browserId ? { kind: "browser", browserId } : null;
    }
    case "file":
      return normalizeFileTabTarget(value);
    case "file-diff": {
      const path = trimNonEmpty(value.path);
      return path ? { kind: "file-diff", path } : null;
    }
    case "setup":
    case "sessions":
      return normalizeWorkspaceIdTabTarget(value.kind, value.workspaceId);
    case "port-forwards":
      return { kind: "port-forwards" };
    default:
      return null;
  }
}

function normalizeWorkspaceIdTabTarget(
  kind: "setup" | "sessions",
  rawWorkspaceId: string | undefined,
): WorkspaceTabTarget | null {
  const workspaceId = trimNonEmpty(rawWorkspaceId);
  if (!workspaceId) {
    return null;
  }
  return kind === "setup" ? { kind: "setup", workspaceId } : { kind: "sessions", workspaceId };
}

export function normalizeWorkspaceDraftTabSetup(
  value: unknown,
): WorkspaceDraftTabSetup | undefined {
  const record = isPlainRecord(value) ? value : null;
  if (!record) {
    return undefined;
  }
  const provider = trimNonEmpty(typeof record.provider === "string" ? record.provider : null);
  const cwd = trimNonEmpty(typeof record.cwd === "string" ? record.cwd : null);
  if (!provider || !cwd) {
    return undefined;
  }
  return {
    provider,
    cwd,
    modeId: trimOptionalString(typeof record.modeId === "string" ? record.modeId : null),
    model: trimOptionalString(typeof record.model === "string" ? record.model : null),
    thinkingOptionId: trimOptionalString(
      typeof record.thinkingOptionId === "string" ? record.thinkingOptionId : null,
    ),
    featureValues: isPlainRecord(record.featureValues) ? { ...record.featureValues } : {},
  };
}

/** Tab kind discrimination spans many branches by design. */
// eslint-disable-next-line complexity -- exhaustive tab-kind discrimination
export function workspaceTabTargetsEqual(
  left: WorkspaceTabTarget,
  right: WorkspaceTabTarget,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "draft":
      return (
        right.kind === "draft" &&
        left.draftId === right.draftId &&
        workspaceDraftTabSetupsEqual(left.setup, right.setup)
      );
    case "agent":
      return right.kind === "agent" && left.agentId === right.agentId;
    case "provider_subagent":
      return (
        right.kind === "provider_subagent" &&
        left.parentAgentId === right.parentAgentId &&
        left.subagentId === right.subagentId
      );
    case "terminal":
      return right.kind === "terminal" && left.terminalId === right.terminalId;
    case "ssh-connecting":
      return right.kind === "ssh-connecting" && left.connectId === right.connectId;
    case "browser":
      return right.kind === "browser" && left.browserId === right.browserId;
    case "file":
      return right.kind === "file" && workspaceFileLocationsEqual(left, right);
    case "file-diff":
      return right.kind === "file-diff" && left.path === right.path;
    case "setup":
    case "sessions": {
      const other = right as Extract<WorkspaceTabTarget, { kind: "setup" | "sessions" }>;
      return left.workspaceId === other.workspaceId;
    }
    case "port-forwards":
      return true;
    default:
      return false;
  }
}

function workspaceDraftTabSetupsEqual(
  left: WorkspaceDraftTabSetup | undefined,
  right: WorkspaceDraftTabSetup | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.provider === right.provider &&
    left.cwd === right.cwd &&
    left.modeId === right.modeId &&
    left.model === right.model &&
    left.thinkingOptionId === right.thinkingOptionId &&
    recordsShallowEqual(left.featureValues, right.featureValues)
  );
}

function recordsShallowEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

export function buildDeterministicWorkspaceTabId(target: WorkspaceTabTarget): string {
  if (target.kind === "draft") {
    return target.draftId;
  }
  if (target.kind === "agent") {
    return `agent_${target.agentId}`;
  }
  if (target.kind === "provider_subagent") {
    return `provider_subagent_${target.parentAgentId.length}_${target.parentAgentId}_${target.subagentId.length}_${target.subagentId}`;
  }
  if (target.kind === "terminal") {
    return `terminal_${target.terminalId}`;
  }
  if (target.kind === "ssh-connecting") {
    return `ssh-connecting_${target.connectId}`;
  }
  if (target.kind === "browser") {
    return `browser_${target.browserId}`;
  }
  if (target.kind === "setup") {
    return `setup_${target.workspaceId}`;
  }
  if (target.kind === "sessions") {
    return `sessions_${target.workspaceId}`;
  }
  if (target.kind === "port-forwards") {
    return "port-forwards";
  }
  if (target.kind === "file-diff") {
    return `filediff_${target.path}`;
  }
  return `file_${target.path}`;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFileTabTarget(
  value: Extract<WorkspaceTabTarget, { kind: "file" }>,
): WorkspaceTabTarget | null {
  const location = normalizeWorkspaceFileLocation(value);
  return location ? { kind: "file", ...location } : null;
}

function trimOptionalString(value: string | null | undefined): string | null {
  return value == null ? null : trimNonEmpty(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
