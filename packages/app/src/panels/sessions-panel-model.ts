import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";

export interface WorkspaceSessionSection {
  /** Workspace id (its directory path), or null for the catch-all section. */
  workspaceId: string | null;
  title: string;
  branch: string | null;
  isCurrent: boolean;
  sessions: AgentDirectoryEntry[];
}

function isUnderDirectory(cwd: string, directory: string): boolean {
  return cwd === directory || cwd.startsWith(`${directory}/`);
}

function compareSiblings(
  left: WorkspaceDescriptor,
  right: WorkspaceDescriptor,
  currentWorkspaceId: string,
): number {
  if (left.id === currentWorkspaceId) return -1;
  if (right.id === currentWorkspaceId) return 1;
  const leftRoot = left.workspaceKind !== "worktree";
  const rightRoot = right.workspaceKind !== "worktree";
  if (leftRoot !== rightRoot) return leftRoot ? -1 : 1;
  return left.name.localeCompare(right.name);
}

/**
 * Groups session history into per-workspace sections for the current
 * workspace's project: the current checkout first, then the project root,
 * then sibling worktrees. Sessions are attributed to the most specific
 * (longest-path) workspace whose directory contains their cwd; sessions under
 * the project root that match no live workspace (e.g. archived worktrees)
 * land in a trailing catch-all section.
 */
export function buildWorkspaceSessionSections(input: {
  currentWorkspaceId: string;
  workspaces: WorkspaceDescriptor[];
  agents: AgentDirectoryEntry[];
  includeArchived: boolean;
  otherSectionTitle: string;
}): WorkspaceSessionSection[] {
  const current = input.workspaces.find((workspace) => workspace.id === input.currentWorkspaceId);
  const siblings = current
    ? input.workspaces.filter((workspace) => workspace.projectId === current.projectId)
    : input.workspaces.filter((workspace) => workspace.id === input.currentWorkspaceId);
  const ordered = [...siblings].sort((left, right) =>
    compareSiblings(left, right, input.currentWorkspaceId),
  );

  const visibleAgents = input.agents.filter(
    (agent) => input.includeArchived || agent.archivedAt == null,
  );

  const sessionsByWorkspaceId = new Map<string, AgentDirectoryEntry[]>();
  const otherSessions: AgentDirectoryEntry[] = [];
  const projectRoot = current?.projectRootPath ?? null;

  for (const agent of visibleAgents) {
    let bestMatch: WorkspaceDescriptor | null = null;
    for (const workspace of ordered) {
      if (!isUnderDirectory(agent.cwd, workspace.workspaceDirectory)) {
        continue;
      }
      if (!bestMatch || workspace.workspaceDirectory.length > bestMatch.workspaceDirectory.length) {
        bestMatch = workspace;
      }
    }
    if (bestMatch) {
      const bucket = sessionsByWorkspaceId.get(bestMatch.id) ?? [];
      bucket.push(agent);
      sessionsByWorkspaceId.set(bestMatch.id, bucket);
      continue;
    }
    if (projectRoot && isUnderDirectory(agent.cwd, projectRoot)) {
      otherSessions.push(agent);
    }
  }

  const byActivityDesc = (left: AgentDirectoryEntry, right: AgentDirectoryEntry) =>
    right.lastActivityAt.getTime() - left.lastActivityAt.getTime();

  const sections: WorkspaceSessionSection[] = ordered.map((workspace) => ({
    workspaceId: workspace.id,
    title: workspace.name,
    branch: workspace.gitRuntime?.currentBranch ?? null,
    isCurrent: workspace.id === input.currentWorkspaceId,
    sessions: (sessionsByWorkspaceId.get(workspace.id) ?? []).sort(byActivityDesc),
  }));

  if (otherSessions.length > 0) {
    sections.push({
      workspaceId: null,
      title: input.otherSectionTitle,
      branch: null,
      isCurrent: false,
      sessions: otherSessions.sort(byActivityDesc),
    });
  }

  return sections;
}
