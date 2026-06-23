import type { SidebarSessionEntry } from "@/hooks/use-sidebar-sessions-list";

/** One workspace group in the new-theme sessions sidebar. */
export interface SidebarSessionGroup {
  /** Stable identity used for collapse state + React keys. */
  key: string;
  /**
   * The workspace this group represents, when the sessions are tied to a live
   * workspace. `null` for aggregate/orphan groups (history sessions whose
   * workspace is gone, or sessions with no workspace id) — those can't be
   * renamed because there is no single workspace to write the title to.
   */
  workspaceId: string | null;
  /**
   * Display label for the group header. The workspace name when the daemon
   * knows it, otherwise the project name (which is always present, derived from
   * the cwd as a last resort), otherwise an empty string for the caller to
   * localize.
   */
  label: string;
  /** Sessions in this group, preserving the caller's recency order. */
  sessions: SidebarSessionEntry[];
}

// Separates the project key from the workspace name in an aggregate group key.
// A NUL byte can't appear in either part, so collisions are impossible.
const PLACEMENT_KEY_SEPARATOR = "\u0000";

/**
 * The visible workspace name for a session. Prefers the daemon-provided
 * `workspaceName` (a worktree's title or branch), then the project name. Both
 * come from `projectPlacement`, which `useSidebarSessionsList` always resolves
 * (falling back to a cwd-derived placement), so this is history-safe.
 */
function resolveGroupLabel(session: SidebarSessionEntry): string {
  const placement = session.projectPlacement;
  const workspaceName = placement?.workspaceName?.trim();
  if (workspaceName) {
    return workspaceName;
  }
  const projectName = placement?.projectName?.trim();
  if (projectName) {
    return projectName;
  }
  return session.projectName?.trim() ?? "";
}

function resolveWorkspaceId(session: SidebarSessionEntry): string | null {
  const workspaceId = session.workspaceId;
  return typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : null;
}

/**
 * Group identity. Sessions tied to a live workspace key on its `workspaceId` so
 * the group maps one-to-one to a renameable workspace. Sessions without one
 * (history whose workspace is gone) fall back to `(projectKey, workspaceName)`,
 * which is stable across the live and history copies of the same session, then
 * to the bare label as a last resort.
 */
function resolveGroupKey(
  session: SidebarSessionEntry,
  workspaceId: string | null,
  label: string,
): string {
  if (workspaceId) {
    return `ws:${workspaceId}`;
  }
  const placement = session.projectPlacement;
  const projectKey = placement?.projectKey?.trim();
  if (projectKey) {
    const workspaceName = placement?.workspaceName?.trim() ?? "";
    return `pp:${projectKey}${PLACEMENT_KEY_SEPARATOR}${workspaceName}`;
  }
  return `lb:${label}`;
}

/**
 * Group an already recency-sorted flat session list by workspace.
 *
 * Group order follows first appearance, so the group containing the single
 * most-recent session leads. Within a group the incoming order is preserved
 * (still recency-sorted). The label comes from the group's first (most recent)
 * session, so a fresh rename surfaces immediately. Pure and order-deterministic.
 */
export function groupSidebarSessionsByWorkspace(
  sessions: SidebarSessionEntry[],
): SidebarSessionGroup[] {
  const groups = new Map<string, SidebarSessionGroup>();
  for (const session of sessions) {
    const workspaceId = resolveWorkspaceId(session);
    const label = resolveGroupLabel(session);
    const key = resolveGroupKey(session, workspaceId, label);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, { key, workspaceId, label, sessions: [session] });
    }
  }
  return Array.from(groups.values());
}
