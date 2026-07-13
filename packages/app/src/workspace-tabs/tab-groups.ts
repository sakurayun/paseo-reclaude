/**
 * Workspace tab groups (Edge-style): contiguous colored bands of tabs that can
 * collapse, rename, and recolor. Membership is stored on the pane; visual runs
 * are derived from pane.tabIds order so reorder stays a flat list.
 */

export const TAB_GROUP_COLOR_IDS = [
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "gray",
] as const;

export type TabGroupColorId = (typeof TAB_GROUP_COLOR_IDS)[number];

export interface WorkspaceTabGroup {
  id: string;
  title: string;
  color: TabGroupColorId;
  collapsed: boolean;
}

/** Fraction of the target tab width treated as the "group with me" center zone. */
export const TAB_GROUP_DROP_CENTER_RATIO = 0.4;

export const TAB_GROUP_COLOR_HEX: Record<TabGroupColorId, string> = {
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#06b6d4",
  gray: "#6b7280",
};

export function isTabGroupColorId(value: unknown): value is TabGroupColorId {
  return typeof value === "string" && (TAB_GROUP_COLOR_IDS as readonly string[]).includes(value);
}

export function normalizeTabGroup(value: unknown): WorkspaceTabGroup | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return null;
  }
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const color = isTabGroupColorId(record.color) ? record.color : "blue";
  return {
    id,
    title: title || "Group",
    color,
    collapsed: record.collapsed === true,
  };
}

export function normalizeTabGroupsRecord(value: unknown): Record<string, WorkspaceTabGroup> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, WorkspaceTabGroup> = {};
  for (const [key, raw] of Object.entries(value)) {
    const group = normalizeTabGroup(raw);
    if (!group) {
      continue;
    }
    // Prefer the group's own id; fall back to the record key.
    const id = group.id || key.trim();
    if (!id) {
      continue;
    }
    next[id] = { ...group, id };
  }
  return next;
}

export function normalizeTabGroupMembership(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [tabId, groupId] of Object.entries(value)) {
    const normalizedTabId = tabId.trim();
    const normalizedGroupId = typeof groupId === "string" ? groupId.trim() : "";
    if (!normalizedTabId || !normalizedGroupId) {
      continue;
    }
    next[normalizedTabId] = normalizedGroupId;
  }
  return next;
}

/**
 * Stable id for a non-contiguous split of an existing group. Idempotent across
 * sanitize passes so collapse/expand/reorder cannot mint infinite group cards.
 */
export function splitTabGroupRunId(sourceGroupId: string, firstTabId: string): string {
  return `${sourceGroupId}::${firstTabId}`;
}

/**
 * Drop membership for closed tabs, dissolve groups with fewer than two members,
 * and enforce contiguity: each contiguous run of a former group is either kept
 * as that group (first run), promoted to its own group (later runs of length
 * ≥ 2), or ungrouped (singleton runs).
 *
 * Without contiguity, reorder-apart members still share one groupId, so the UI
 * draws a header (or collapsed chip) per run — collapse/expand then looks like
 * groups are "multiplying."
 */
export function sanitizePaneTabGroups(input: {
  tabIds: readonly string[];
  tabGroups: Record<string, WorkspaceTabGroup> | undefined;
  tabGroupIdByTabId: Record<string, string> | undefined;
}): {
  tabGroups: Record<string, WorkspaceTabGroup> | undefined;
  tabGroupIdByTabId: Record<string, string> | undefined;
} {
  const openTabIds = new Set(input.tabIds);
  const groups = normalizeTabGroupsRecord(input.tabGroups);
  const membership = normalizeTabGroupMembership(input.tabGroupIdByTabId);

  const liveMembership: Record<string, string> = {};
  for (const [tabId, groupId] of Object.entries(membership)) {
    if (!openTabIds.has(tabId) || !groups[groupId]) {
      continue;
    }
    liveMembership[tabId] = groupId;
  }

  // Contiguous runs in pane tab order (Edge-style groups are always adjacent).
  const runs: Array<{ sourceGroupId: string; tabIds: string[] }> = [];
  let index = 0;
  while (index < input.tabIds.length) {
    const tabId = input.tabIds[index]!;
    const groupId = liveMembership[tabId];
    if (!groupId) {
      index += 1;
      continue;
    }
    const runTabIds = [tabId];
    let cursor = index + 1;
    while (cursor < input.tabIds.length) {
      const nextTabId = input.tabIds[cursor]!;
      if (liveMembership[nextTabId] !== groupId) {
        break;
      }
      runTabIds.push(nextTabId);
      cursor += 1;
    }
    runs.push({ sourceGroupId: groupId, tabIds: runTabIds });
    index = cursor;
  }

  const nextMembership: Record<string, string> = {};
  const nextGroups: Record<string, WorkspaceTabGroup> = {};
  // First contiguous run (≥2) of each source group keeps the original id.
  const claimedOriginalGroupIds = new Set<string>();

  for (const run of runs) {
    if (run.tabIds.length < 2) {
      // Singleton cannot be a group — drop membership.
      continue;
    }
    const source = groups[run.sourceGroupId];
    if (!source) {
      continue;
    }

    let assignedGroupId: string;
    if (!claimedOriginalGroupIds.has(run.sourceGroupId) && !nextGroups[run.sourceGroupId]) {
      assignedGroupId = run.sourceGroupId;
      claimedOriginalGroupIds.add(run.sourceGroupId);
      nextGroups[assignedGroupId] = { ...source, id: assignedGroupId };
    } else {
      const firstTabId = run.tabIds[0]!;
      assignedGroupId = splitTabGroupRunId(run.sourceGroupId, firstTabId);
      // If this stable id was already the source id of this run (re-sanitize),
      // keep its existing record/collapsed state when present.
      const existing = groups[assignedGroupId] ?? nextGroups[assignedGroupId];
      nextGroups[assignedGroupId] = existing
        ? { ...existing, id: assignedGroupId }
        : {
            id: assignedGroupId,
            title: source.title,
            color: source.color,
            // Fresh splits start expanded so both bands stay visible.
            collapsed: false,
          };
    }

    for (const tabId of run.tabIds) {
      nextMembership[tabId] = assignedGroupId;
    }
  }

  const hasGroups = Object.keys(nextGroups).length > 0;
  return {
    tabGroups: hasGroups ? nextGroups : undefined,
    tabGroupIdByTabId: hasGroups ? nextMembership : undefined,
  };
}

export type TabDropKind = "reorder" | "group";

/**
 * Decide whether a drag over a target tab is a reorder (edge) or a group
 * (center band). `relativeX` is the active center X relative to the over tab's
 * left edge; `overWidth` is the over tab width.
 */
export function resolveTabDropKind(input: {
  relativeX: number;
  overWidth: number;
  /** Same tab — never group onto self. */
  isSameTab: boolean;
  centerRatio?: number;
}): TabDropKind {
  if (input.isSameTab || input.overWidth <= 0) {
    return "reorder";
  }
  const ratio = input.centerRatio ?? TAB_GROUP_DROP_CENTER_RATIO;
  const edge = (1 - ratio) / 2;
  const normalized = input.relativeX / input.overWidth;
  if (normalized > edge && normalized < 1 - edge) {
    return "group";
  }
  return "reorder";
}

/**
 * Detect a single arrayMove-style relocation: exactly one id changed index and
 * the relative order of all other ids is unchanged. Returns null when the
 * permutation is empty, multi-move, or lengths differ.
 */
export function findSingleMovedTabId(
  previousTabIds: readonly string[],
  nextTabIds: readonly string[],
): string | null {
  if (previousTabIds.length !== nextTabIds.length || previousTabIds.length === 0) {
    return null;
  }
  if (previousTabIds.every((id, index) => id === nextTabIds[index])) {
    return null;
  }

  let moved: string | null = null;
  for (const candidate of previousTabIds) {
    const prevWithout = previousTabIds.filter((id) => id !== candidate);
    const nextWithout = nextTabIds.filter((id) => id !== candidate);
    if (prevWithout.length !== nextWithout.length) {
      continue;
    }
    if (!prevWithout.every((id, index) => id === nextWithout[index])) {
      continue;
    }
    if (previousTabIds.indexOf(candidate) === nextTabIds.indexOf(candidate)) {
      continue;
    }
    if (moved !== null) {
      return null;
    }
    moved = candidate;
  }
  return moved;
}

/**
 * After a tab is reordered (including drop between two group members — edge
 * zone, not only center-on-tab), rebind its group membership from neighbors:
 * - both sides same group → join that group (insert into the band)
 * - only left/right in a group → expand that group (drop at band edge)
 * - between two different groups → leave ungrouped
 * - no adjacent group → leave ungrouped (drag out of a group)
 */
export function resolveMovedTabGroupMembership(input: {
  tabIds: readonly string[];
  tabGroupIdByTabId: Record<string, string>;
  movedTabId: string;
}): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [tabId, groupId] of Object.entries(input.tabGroupIdByTabId)) {
    if (input.tabIds.includes(tabId)) {
      next[tabId] = groupId;
    }
  }

  const index = input.tabIds.indexOf(input.movedTabId);
  if (index < 0) {
    return next;
  }

  const leftId = index > 0 ? input.tabIds[index - 1] : null;
  const rightId = index < input.tabIds.length - 1 ? input.tabIds[index + 1] : null;
  const leftGroupId = leftId ? (next[leftId] ?? null) : null;
  const rightGroupId = rightId ? (next[rightId] ?? null) : null;

  if (leftGroupId && rightGroupId && leftGroupId === rightGroupId) {
    next[input.movedTabId] = leftGroupId;
    return next;
  }
  if (leftGroupId && rightGroupId && leftGroupId !== rightGroupId) {
    delete next[input.movedTabId];
    return next;
  }
  if (leftGroupId) {
    next[input.movedTabId] = leftGroupId;
    return next;
  }
  if (rightGroupId) {
    next[input.movedTabId] = rightGroupId;
    return next;
  }
  delete next[input.movedTabId];
  return next;
}

/**
 * Any tab sitting between two members of the same group is absorbed into that
 * group (covers edge drops between members even if move detection is ambiguous).
 */
export function absorbSandwichedTabsIntoGroups(
  tabIds: readonly string[],
  tabGroupIdByTabId: Record<string, string>,
): Record<string, string> {
  const next = { ...tabGroupIdByTabId };
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < tabIds.length - 1; index += 1) {
      const tabId = tabIds[index]!;
      const leftGroupId = next[tabIds[index - 1]!];
      const rightGroupId = next[tabIds[index + 1]!];
      if (leftGroupId && leftGroupId === rightGroupId && next[tabId] !== leftGroupId) {
        next[tabId] = leftGroupId;
        changed = true;
      }
    }
  }
  return next;
}

/**
 * Build a new tab order that places `sourceTabId` immediately after
 * `targetTabId` (or before when `placeBefore` is true), keeping other order.
 */
export function moveTabBeside(input: {
  tabIds: readonly string[];
  sourceTabId: string;
  targetTabId: string;
  placeBefore: boolean;
}): string[] {
  const withoutSource = input.tabIds.filter((id) => id !== input.sourceTabId);
  const targetIndex = withoutSource.indexOf(input.targetTabId);
  if (targetIndex < 0) {
    return [...input.tabIds];
  }
  const insertAt = input.placeBefore ? targetIndex : targetIndex + 1;
  const next = [...withoutSource];
  next.splice(insertAt, 0, input.sourceTabId);
  return next;
}

export function assignTabsToGroup(input: {
  tabGroups: Record<string, WorkspaceTabGroup>;
  tabGroupIdByTabId: Record<string, string>;
  tabIds: readonly string[];
  sourceTabId: string;
  targetTabId: string;
  createGroupId: () => string;
  defaultTitle: string;
}): {
  tabIds: string[];
  tabGroups: Record<string, WorkspaceTabGroup>;
  tabGroupIdByTabId: Record<string, string>;
} {
  const sourceIndex = input.tabIds.indexOf(input.sourceTabId);
  const targetIndex = input.tabIds.indexOf(input.targetTabId);
  if (sourceIndex < 0 || targetIndex < 0 || input.sourceTabId === input.targetTabId) {
    return {
      tabIds: [...input.tabIds],
      tabGroups: { ...input.tabGroups },
      tabGroupIdByTabId: { ...input.tabGroupIdByTabId },
    };
  }

  // Place the dragged tab immediately after the drop target so they form a
  // contiguous pair (Edge-style grouping always keeps members adjacent).
  const ordered = moveTabBeside({
    tabIds: input.tabIds,
    sourceTabId: input.sourceTabId,
    targetTabId: input.targetTabId,
    placeBefore: false,
  });

  const nextGroups = { ...input.tabGroups };
  const nextMembership = { ...input.tabGroupIdByTabId };

  const targetGroupId = nextMembership[input.targetTabId];
  const sourceGroupId = nextMembership[input.sourceTabId];

  let groupId: string;
  if (targetGroupId && nextGroups[targetGroupId]) {
    groupId = targetGroupId;
  } else if (sourceGroupId && nextGroups[sourceGroupId]) {
    groupId = sourceGroupId;
  } else {
    groupId = input.createGroupId();
    nextGroups[groupId] = {
      id: groupId,
      title: input.defaultTitle,
      color: "blue",
      collapsed: false,
    };
  }

  nextMembership[input.sourceTabId] = groupId;
  nextMembership[input.targetTabId] = groupId;

  // If source and target were in different groups, merge source's former
  // members into the chosen group.
  if (sourceGroupId && sourceGroupId !== groupId && nextGroups[sourceGroupId]) {
    for (const [tabId, gid] of Object.entries(nextMembership)) {
      if (gid === sourceGroupId) {
        nextMembership[tabId] = groupId;
      }
    }
    delete nextGroups[sourceGroupId];
  }

  const sanitized = sanitizePaneTabGroups({
    tabIds: ordered,
    tabGroups: nextGroups,
    tabGroupIdByTabId: nextMembership,
  });

  return {
    tabIds: ordered,
    tabGroups: sanitized.tabGroups ?? {},
    tabGroupIdByTabId: sanitized.tabGroupIdByTabId ?? {},
  };
}

export type TabGroupVisualRole = "none" | "start" | "middle" | "end" | "only";

export function resolveTabGroupVisualRole(input: {
  tabIds: readonly string[];
  index: number;
  tabGroupIdByTabId: Record<string, string> | undefined;
}): { groupId: string | null; role: TabGroupVisualRole } {
  const tabId = input.tabIds[input.index];
  if (!tabId || !input.tabGroupIdByTabId) {
    return { groupId: null, role: "none" };
  }
  const groupId = input.tabGroupIdByTabId[tabId] ?? null;
  if (!groupId) {
    return { groupId: null, role: "none" };
  }
  const prevId = input.index > 0 ? input.tabIds[input.index - 1] : null;
  const nextId = input.index < input.tabIds.length - 1 ? input.tabIds[input.index + 1] : null;
  const prevSame = Boolean(prevId && input.tabGroupIdByTabId[prevId] === groupId);
  const nextSame = Boolean(nextId && input.tabGroupIdByTabId[nextId] === groupId);
  if (!prevSame && !nextSame) {
    // Single-tab group should not exist after sanitize, but treat as only.
    return { groupId, role: "only" };
  }
  if (!prevSame && nextSame) {
    return { groupId, role: "start" };
  }
  if (prevSame && !nextSame) {
    return { groupId, role: "end" };
  }
  if (prevSame && nextSame) {
    return { groupId, role: "middle" };
  }
  return { groupId, role: "none" };
}

/**
 * Build the visible row sequence for a pane: expanded group members stay as
 * individual tabs; collapsed groups collapse to a single placeholder whose
 * key is the group id.
 */
export function buildTabRowSegments(input: {
  tabIds: readonly string[];
  tabGroups: Record<string, WorkspaceTabGroup> | undefined;
  tabGroupIdByTabId: Record<string, string> | undefined;
}): Array<
  | { kind: "tab"; tabId: string; groupId: string | null; role: TabGroupVisualRole }
  | { kind: "collapsed-group"; groupId: string; tabIds: string[] }
> {
  const groups = input.tabGroups ?? {};
  const membership = input.tabGroupIdByTabId ?? {};
  const segments: Array<
    | { kind: "tab"; tabId: string; groupId: string | null; role: TabGroupVisualRole }
    | { kind: "collapsed-group"; groupId: string; tabIds: string[] }
  > = [];

  let index = 0;
  while (index < input.tabIds.length) {
    const tabId = input.tabIds[index]!;
    const groupId = membership[tabId] ?? null;
    const group = groupId ? groups[groupId] : null;

    if (group?.collapsed) {
      const memberIds: string[] = [];
      let cursor = index;
      while (cursor < input.tabIds.length) {
        const id = input.tabIds[cursor]!;
        if (membership[id] !== groupId) {
          break;
        }
        memberIds.push(id);
        cursor += 1;
      }
      segments.push({ kind: "collapsed-group", groupId: group.id, tabIds: memberIds });
      index = cursor;
      continue;
    }

    const { role } = resolveTabGroupVisualRole({
      tabIds: input.tabIds,
      index,
      tabGroupIdByTabId: membership,
    });
    segments.push({ kind: "tab", tabId, groupId, role });
    index += 1;
  }

  return segments;
}
