import { describe, expect, it } from "vitest";
import {
  assignTabsToGroup,
  buildTabRowSegments,
  moveTabBeside,
  resolveTabDropKind,
  resolveTabGroupVisualRole,
  sanitizePaneTabGroups,
} from "@/workspace-tabs/tab-groups";

describe("resolveTabDropKind", () => {
  it("groups when the pointer is in the center band", () => {
    expect(resolveTabDropKind({ relativeX: 50, overWidth: 100, isSameTab: false })).toBe("group");
  });

  it("reorders near the edges", () => {
    expect(resolveTabDropKind({ relativeX: 5, overWidth: 100, isSameTab: false })).toBe("reorder");
    expect(resolveTabDropKind({ relativeX: 95, overWidth: 100, isSameTab: false })).toBe("reorder");
  });

  it("never groups onto self", () => {
    expect(resolveTabDropKind({ relativeX: 50, overWidth: 100, isSameTab: true })).toBe("reorder");
  });
});

describe("moveTabBeside", () => {
  it("places the source after the target by default", () => {
    expect(
      moveTabBeside({
        tabIds: ["a", "b", "c", "d"],
        sourceTabId: "d",
        targetTabId: "b",
        placeBefore: false,
      }),
    ).toEqual(["a", "b", "d", "c"]);
  });

  it("places the source before the target when requested", () => {
    expect(
      moveTabBeside({
        tabIds: ["a", "b", "c"],
        sourceTabId: "c",
        targetTabId: "a",
        placeBefore: true,
      }),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("assignTabsToGroup", () => {
  it("creates a new group when neither tab is grouped", () => {
    const result = assignTabsToGroup({
      tabGroups: {},
      tabGroupIdByTabId: {},
      tabIds: ["a", "b", "c"],
      sourceTabId: "c",
      targetTabId: "a",
      createGroupId: () => "g1",
      defaultTitle: "Group",
    });
    expect(result.tabIds).toEqual(["a", "c", "b"]);
    expect(result.tabGroups.g1).toMatchObject({
      id: "g1",
      title: "Group",
      color: "blue",
      collapsed: false,
    });
    expect(result.tabGroupIdByTabId).toEqual({ a: "g1", c: "g1" });
  });

  it("joins an existing target group", () => {
    const result = assignTabsToGroup({
      tabGroups: {
        g1: { id: "g1", title: "Work", color: "green", collapsed: false },
      },
      tabGroupIdByTabId: { a: "g1", b: "g1" },
      tabIds: ["a", "b", "c"],
      sourceTabId: "c",
      targetTabId: "b",
      createGroupId: () => "g-new",
      defaultTitle: "Group",
    });
    expect(result.tabGroupIdByTabId.c).toBe("g1");
    expect(result.tabGroups.g1?.title).toBe("Work");
  });
});

describe("sanitizePaneTabGroups", () => {
  it("dissolves groups with fewer than two live members", () => {
    const result = sanitizePaneTabGroups({
      tabIds: ["a", "b"],
      tabGroups: {
        g1: { id: "g1", title: "G", color: "blue", collapsed: false },
      },
      tabGroupIdByTabId: { a: "g1", missing: "g1" },
    });
    expect(result.tabGroups).toBeUndefined();
    expect(result.tabGroupIdByTabId).toBeUndefined();
  });

  it("keeps groups with two or more live members", () => {
    const result = sanitizePaneTabGroups({
      tabIds: ["a", "b", "c"],
      tabGroups: {
        g1: { id: "g1", title: "G", color: "blue", collapsed: true },
      },
      tabGroupIdByTabId: { a: "g1", b: "g1" },
    });
    expect(result.tabGroups?.g1?.collapsed).toBe(true);
    expect(result.tabGroupIdByTabId).toEqual({ a: "g1", b: "g1" });
  });
});

describe("buildTabRowSegments", () => {
  it("collapses consecutive members of a collapsed group", () => {
    const segments = buildTabRowSegments({
      tabIds: ["a", "b", "c", "d"],
      tabGroups: {
        g1: { id: "g1", title: "G", color: "blue", collapsed: true },
      },
      tabGroupIdByTabId: { b: "g1", c: "g1" },
    });
    expect(segments).toEqual([
      { kind: "tab", tabId: "a", groupId: null, role: "none" },
      { kind: "collapsed-group", groupId: "g1", tabIds: ["b", "c"] },
      { kind: "tab", tabId: "d", groupId: null, role: "none" },
    ]);
  });

  it("marks expanded group roles for contiguous members", () => {
    expect(
      resolveTabGroupVisualRole({
        tabIds: ["a", "b", "c"],
        index: 0,
        tabGroupIdByTabId: { a: "g", b: "g", c: "g" },
      }),
    ).toEqual({ groupId: "g", role: "start" });
    expect(
      resolveTabGroupVisualRole({
        tabIds: ["a", "b", "c"],
        index: 1,
        tabGroupIdByTabId: { a: "g", b: "g", c: "g" },
      }),
    ).toEqual({ groupId: "g", role: "middle" });
    expect(
      resolveTabGroupVisualRole({
        tabIds: ["a", "b", "c"],
        index: 2,
        tabGroupIdByTabId: { a: "g", b: "g", c: "g" },
      }),
    ).toEqual({ groupId: "g", role: "end" });
  });
});
