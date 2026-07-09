import type { SidebarSessionEntry } from "@/hooks/use-sidebar-sessions-list";
import { deriveProjectDisplayName } from "@/utils/agent-grouping";
import { parseGitHubRepoFromRemote } from "@/git/github-url";

export type SidebarProjectNameOverrides = ReadonlyMap<string, string>;
export type SidebarSessionGroupIconKind = "folder" | "git-folder" | "github";

/** One project group in the new-theme sessions sidebar. */
export interface SidebarSessionGroup {
  /** Stable identity used for collapse state + React keys. */
  key: string;
  /** Project identity used for project-level actions such as rename. */
  projectKey: string | null;
  /**
   * Project groups do not map one-to-one to a live workspace, so they are not
   * renameable through the workspace-title API.
   */
  workspaceId: string | null;
  /**
   * Display label for the group header. Git-backed projects use their stable
   * project display name (for GitHub remotes: owner/repo, e.g.
   * sakurayun/paseo-reclaude), otherwise the local project name.
   */
  label: string;
  /**
   * Canonical project label derived from the stable project key. When `label`
   * is a user override, the UI shows this as muted supporting text to avoid
   * hiding the real repository identity.
   */
  baseLabel: string;
  /** Project icon shown in the group header. */
  iconKind: SidebarSessionGroupIconKind;
  /** Sessions in this group, preserving the caller's recency order. */
  sessions: SidebarSessionEntry[];
}

export interface SidebarSessionGroupWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveProjectKey(session: SidebarSessionEntry): string | null {
  const projectKey = session.projectPlacement?.projectKey?.trim();
  return projectKey && projectKey.length > 0 ? projectKey : null;
}

function resolveBaseLabel(session: SidebarSessionEntry, projectKey: string | null): string {
  if (!projectKey) {
    return session.projectName?.trim() ?? "";
  }
  if (!projectKey.startsWith("remote:")) {
    const projectName =
      session.projectPlacement?.projectName?.trim() ?? session.projectName?.trim();
    if (projectName) {
      return projectName;
    }
  }
  return deriveProjectDisplayName({
    projectKey,
    projectName: "",
  });
}

function resolveIconKind(
  session: SidebarSessionEntry,
  projectKey: string | null,
): SidebarSessionGroupIconKind {
  const checkout = session.projectPlacement?.checkout;
  if (
    projectKey?.startsWith("remote:github.com/") ||
    parseGitHubRepoFromRemote(checkout?.remoteUrl)
  ) {
    return "github";
  }
  if (checkout?.isGit) {
    return "git-folder";
  }
  return "folder";
}

/**
 * The visible project name for a session. `projectPlacement.projectName` may be
 * custom/local; `deriveProjectDisplayName` makes remote keys display as
 * owner/repo instead of per-workspace titles.
 */
function resolveGroupLabel(
  session: SidebarSessionEntry,
  projectKey: string | null,
  projectNameOverrides: SidebarProjectNameOverrides | undefined,
): string {
  if (projectKey) {
    const override = projectNameOverrides?.get(projectKey)?.trim();
    if (override) {
      return override;
    }
  }
  const placement = session.projectPlacement;
  if (placement) {
    return deriveProjectDisplayName({
      projectKey: placement.projectKey,
      projectName: placement.projectName,
    });
  }
  return session.projectName?.trim() ?? "";
}

/**
 * Group identity. New-theme session navigation is project-first: opening a new
 * conversation creates a new workspace/session, but it should remain under the
 * same repository/project header. Keying on workspaceId would make every new
 * conversation create a new group.
 */
function resolveGroupKey(session: SidebarSessionEntry, label: string): string {
  const projectKey = resolveProjectKey(session);
  if (projectKey) {
    return `project:${projectKey}`;
  }
  return `lb:${label}`;
}

/**
 * Group an already recency-sorted flat session list by project.
 *
 * Group order follows first appearance, so the group containing the single
 * most-recent session leads. Within a group the incoming order is preserved
 * (still recency-sorted). The label comes from the group's project placement,
 * so all sessions in one repository collapse under the same owner/repo-style
 * header. Pure and order-deterministic.
 */
export function groupSidebarSessionsByProject(
  sessions: SidebarSessionEntry[],
  projectNameOverrides?: SidebarProjectNameOverrides,
): SidebarSessionGroup[] {
  const groups = new Map<string, SidebarSessionGroup>();
  for (const session of sessions) {
    const projectKey = resolveProjectKey(session);
    const label = resolveGroupLabel(session, projectKey, projectNameOverrides);
    const baseLabel = resolveBaseLabel(session, projectKey);
    const iconKind = resolveIconKind(session, projectKey);
    const key = resolveGroupKey(session, label);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        key,
        projectKey,
        workspaceId: null,
        label,
        baseLabel,
        iconKind,
        sessions: [session],
      });
    }
  }
  return Array.from(groups.values());
}

interface SidebarTerminalLike {
  id: string;
  cwd?: string;
  workspaceId?: string;
}

function isSameOrDescendantDirectory(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * Assign host-wide terminals to the sidebar's project groups. A terminal
 * belongs to the group that contains a session in the same workspace, or —
 * failing that — a session whose cwd is an ancestor/descendant of the
 * terminal's cwd (longest ancestor wins). Terminals matching no group (e.g.
 * standalone terminals outside any listed project) are omitted. Pure and
 * order-preserving.
 */
export function assignTerminalsToSidebarGroups<TTerminal extends SidebarTerminalLike>(
  groups: readonly SidebarSessionGroup[],
  terminals: readonly TTerminal[],
): Map<string, TTerminal[]> {
  const groupKeyByWorkspaceId = new Map<string, string>();
  const sessionCwds: Array<{ cwd: string; groupKey: string }> = [];
  for (const group of groups) {
    for (const session of group.sessions) {
      const workspaceId = trimNonEmpty(session.workspaceId);
      if (workspaceId && !groupKeyByWorkspaceId.has(workspaceId)) {
        groupKeyByWorkspaceId.set(workspaceId, group.key);
      }
      const cwd = trimNonEmpty(session.cwd);
      if (cwd) {
        sessionCwds.push({ cwd, groupKey: group.key });
      }
    }
  }

  function resolveGroupKeyForTerminal(terminal: TTerminal): string | null {
    const workspaceId = trimNonEmpty(terminal.workspaceId);
    if (workspaceId) {
      const byWorkspace = groupKeyByWorkspaceId.get(workspaceId);
      if (byWorkspace) {
        return byWorkspace;
      }
    }
    const terminalCwd = trimNonEmpty(terminal.cwd);
    if (!terminalCwd) {
      return null;
    }
    let bestAncestor: { cwd: string; groupKey: string } | null = null;
    for (const candidate of sessionCwds) {
      if (!isSameOrDescendantDirectory(candidate.cwd, terminalCwd)) {
        continue;
      }
      if (!bestAncestor || candidate.cwd.length > bestAncestor.cwd.length) {
        bestAncestor = candidate;
      }
    }
    if (bestAncestor) {
      return bestAncestor.groupKey;
    }
    for (const candidate of sessionCwds) {
      if (isSameOrDescendantDirectory(terminalCwd, candidate.cwd)) {
        return candidate.groupKey;
      }
    }
    return null;
  }

  const byGroupKey = new Map<string, TTerminal[]>();
  for (const terminal of terminals) {
    const groupKey = resolveGroupKeyForTerminal(terminal);
    if (!groupKey) {
      continue;
    }
    const bucket = byGroupKey.get(groupKey);
    if (bucket) {
      bucket.push(terminal);
    } else {
      byGroupKey.set(groupKey, [terminal]);
    }
  }
  return byGroupKey;
}

export function resolveSidebarSessionGroupWorkspaceTarget(
  group: SidebarSessionGroup,
  serverId: string | null,
): SidebarSessionGroupWorkspaceTarget | null {
  const normalizedServerId = trimNonEmpty(serverId);
  if (!normalizedServerId) {
    return null;
  }

  for (const session of group.sessions) {
    const workspaceId = trimNonEmpty(session.workspaceId);
    if (workspaceId) {
      return { serverId: normalizedServerId, workspaceId };
    }
  }

  return null;
}
