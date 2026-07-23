import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { WorkspaceFileTabTarget } from "@/workspace/file-open";

export interface WorkspaceDraftTabSetup {
  provider: AgentProvider;
  cwd: string;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
}

export interface WorkspaceWorkingDiffTabTarget {
  kind: "working_diff";
  focusPath?: string;
  focusRequestId?: number;
}

export type WorkspaceTabTarget =
  | { kind: "draft"; draftId: string; setup?: WorkspaceDraftTabSetup }
  | { kind: "agent"; agentId: string }
  | { kind: "provider_subagent"; parentAgentId: string; subagentId: string }
  | { kind: "terminal"; terminalId: string }
  // Transient tab hosting an in-flight SSH connect (progress log + inline
  // password/mismatch retry). Retargets to a terminal tab on success. State
  // lives in ssh-connect-store keyed by connectId; never persisted or synced.
  | { kind: "ssh-connecting"; connectId: string }
  | { kind: "browser"; browserId: string }
  | WorkspaceFileTabTarget
  | WorkspaceWorkingDiffTabTarget
  | { kind: "file-diff"; path: string }
  | { kind: "commit_diff"; sha: string }
  | { kind: "setup"; workspaceId: string }
  | { kind: "sessions"; workspaceId: string }
  | { kind: "port-forwards" };

export interface WorkspaceTab {
  tabId: string;
  target: WorkspaceTabTarget;
  createdAt: number;
}

export function buildWorkspaceTabPersistenceKey(input: {
  serverId: string;
  workspaceId: string;
}): string | null {
  const serverId = input.serverId.trim();
  const workspaceId = input.workspaceId.trim();
  if (!serverId || !workspaceId) {
    return null;
  }
  // workspaceId is opaque; do not parse this key back into a path.
  return `${serverId}:${workspaceId}`;
}
