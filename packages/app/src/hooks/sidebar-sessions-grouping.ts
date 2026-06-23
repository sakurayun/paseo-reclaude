import type { SidebarSessionEntry } from "@/hooks/use-sidebar-sessions-list";
import { deriveProjectDisplayName } from "@/utils/agent-grouping";

/** One project group in the new-theme sessions sidebar. */
export interface SidebarSessionGroup {
  /** Stable identity used for collapse state + React keys. */
  key: string;
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
  /** Sessions in this group, preserving the caller's recency order. */
  sessions: SidebarSessionEntry[];
}

/**
 * The visible project name for a session. `projectPlacement.projectName` may be
 * custom/local; `deriveProjectDisplayName` makes remote keys display as
 * owner/repo instead of per-workspace titles.
 */
function resolveGroupLabel(session: SidebarSessionEntry): string {
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
  const placement = session.projectPlacement;
  const projectKey = placement?.projectKey?.trim();
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
): SidebarSessionGroup[] {
  const groups = new Map<string, SidebarSessionGroup>();
  for (const session of sessions) {
    const label = resolveGroupLabel(session);
    const key = resolveGroupKey(session, label);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, { key, workspaceId: null, label, sessions: [session] });
    }
  }
  return Array.from(groups.values());
}
