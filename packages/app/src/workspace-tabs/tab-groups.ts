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
 * Drop membership for closed tabs, drop empty/orphan groups, and dissolve
 * groups that no longer have at least two members.
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

  const nextMembership: Record<string, string> = {};
  const memberCountByGroup = new Map<string, number>();
  for (const [tabId, groupId] of Object.entries(membership)) {
    if (!openTabIds.has(tabId) || !groups[groupId]) {
      continue;
    }
    nextMembership[tabId] = groupId;
    memberCountByGroup.set(groupId, (memberCountByGroup.get(groupId) ?? 0) + 1);
  }

  const nextGroups: Record<string, WorkspaceTabGroup> = {};
  for (const [groupId, group] of Object.entries(groups)) {
    if ((memberCountByGroup.get(groupId) ?? 0) >= 2) {
      nextGroups[groupId] = group;
    }
  }

  // Drop membership pointing at dissolved groups.
  for (const tabId of Object.keys(nextMembership)) {
    if (!nextGroups[nextMembership[tabId]!]) {
      delete nextMembership[tabId];
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
