import type { ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import { resolveProjectPlacement } from "@/utils/project-placement";
import type { SidebarSessionEntry } from "./use-sidebar-sessions-list";

/**
 * A placement is "authoritative" when it carries real git identity reported by
 * the daemon — a remote-backed project key, or a git checkout. cwd-fallback
 * placements (`deriveProjectPlacementFromCwd`) set `isGit: false` and a
 * path-based key; they are only a stopgap until the daemon reports the real
 * placement for a session.
 */
function isAuthoritativePlacement(placement: ProjectPlacementPayload | null | undefined): boolean {
  return Boolean(
    placement && (placement.projectKey.startsWith("remote:") || placement.checkout?.isGit === true),
  );
}

/**
 * Guarantee every session has a placement for grouping, and let a freshly
 * created session inherit its repository's authoritative placement.
 *
 * A new conversation shows up (via the timeline snapshot) before the daemon has
 * computed its project placement. Without this it would flash under the
 * cwd-derived / "Other" group for a few seconds, then jump to its real project
 * group once the placement arrives. Inheriting the authoritative placement of a
 * sibling session in the same directory lands the new session under the correct
 * project header immediately. Sessions with no authoritative sibling fall back
 * to a cwd-derived placement so grouping is never empty.
 */
export function applySidebarSessionPlacements(
  entries: SidebarSessionEntry[],
): SidebarSessionEntry[] {
  const authoritativeByCwd = new Map<string, ProjectPlacementPayload>();
  for (const entry of entries) {
    const placement = entry.projectPlacement;
    if (
      entry.cwd &&
      placement &&
      isAuthoritativePlacement(placement) &&
      !authoritativeByCwd.has(entry.cwd)
    ) {
      authoritativeByCwd.set(entry.cwd, placement);
    }
  }

  return entries.map((entry) => {
    if (isAuthoritativePlacement(entry.projectPlacement)) {
      return entry;
    }
    const placement =
      (entry.cwd ? authoritativeByCwd.get(entry.cwd) : undefined) ??
      resolveProjectPlacement({ projectPlacement: entry.projectPlacement, cwd: entry.cwd });
    if (placement === entry.projectPlacement) {
      return entry;
    }
    return {
      ...entry,
      projectPlacement: placement,
      projectName: placement.projectName ?? entry.projectName,
    };
  });
}
