import { describe, expect, it } from "vitest";

import {
  collectAllPanes,
  collectAllTabs,
  createDefaultLayout,
  findPaneById,
  mergeRemoteLayoutPreservingFocus,
  openTabInLayoutFocused,
  stripWorkspaceLayoutFocus,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

// Build a single-pane layout with the given agent tabs; the last one opened is focused
// (openTabInLayoutFocused focuses each newly opened tab).
function buildAgentLayout(agentIds: string[]): WorkspaceLayout {
  let layout = createDefaultLayout();
  for (const agentId of agentIds) {
    layout = openTabInLayoutFocused({
      layout,
      target: { kind: "agent", agentId },
      now: 1,
    }).layout;
  }
  return layout;
}

function tabIdsOf(layout: WorkspaceLayout): string[] {
  return collectAllTabs(layout.root).map((tab) => tab.tabId);
}

describe("stripWorkspaceLayoutFocus", () => {
  it("clears pane and layout focus but preserves tabs and order", () => {
    const layout = buildAgentLayout(["a1", "a2"]); // a2 focused
    const stripped = stripWorkspaceLayoutFocus(layout);

    expect(stripped.focusedPaneId).toBeNull();
    for (const pane of collectAllPanes(stripped.root)) {
      expect(pane.focusedTabId).toBeNull();
    }
    expect(tabIdsOf(stripped)).toEqual(["agent_a1", "agent_a2"]);
  });

  it("produces an identical stripped blob for two layouts that differ only in focus", () => {
    const focusedA1 = buildAgentLayout(["a2", "a1"]); // a1 focused
    const focusedA2 = buildAgentLayout(["a1", "a2"]); // a2 focused, same tab set
    // Reorder focusedA1 to match focusedA2's tab order so only focus differs.
    expect(JSON.stringify(stripWorkspaceLayoutFocus(focusedA2))).toEqual(
      JSON.stringify(stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2"]))),
    );
    // Sanity: focus genuinely differed before stripping.
    expect(findPaneById(focusedA1.root, "main")?.focusedTabId).toBe("agent_a1");
    expect(findPaneById(focusedA2.root, "main")?.focusedTabId).toBe("agent_a2");
  });
});

describe("mergeRemoteLayoutPreservingFocus", () => {
  it("adopts remote structure while keeping local focus when it still exists", () => {
    const local = buildAgentLayout(["a2", "a1"]); // local focuses a1
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2", "a3"]));

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    // Structure (tab set + order) comes from remote.
    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a2", "agent_a3"]);
    // Focus stays local: a1 is still present in the remote tree.
    expect(findPaneById(merged.root, "main")?.focusedTabId).toBe("agent_a1");
  });

  it("falls back to remote focus when the local focused tab is gone in remote", () => {
    const local = buildAgentLayout(["a9"]); // local focuses a9
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2"]));

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a2"]);
    // a9 is gone in remote → normalizeLayout falls back to the last tab; never throws.
    expect(findPaneById(merged.root, "main")?.focusedTabId).toBe("agent_a2");
  });

  it("drops a tab the remote removed", () => {
    const local = buildAgentLayout(["a1", "a2", "a3"]);
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a3"])); // a2 closed elsewhere

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a3"]);
  });
});
