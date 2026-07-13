import { describe, expect, it } from "vitest";
import { computeTabDropPreview } from "@/components/split-container-tab-drop-preview";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function tab(tabId: string): WorkspaceTabDescriptor {
  return {
    key: tabId,
    tabId,
    kind: "draft",
    target: {
      kind: "draft",
      draftId: tabId,
    },
  };
}

describe("computeTabDropPreview", () => {
  const targetTabs = [tab("a"), tab("b"), tab("c"), tab("d")];

  it("returns a before-target insertion index for cross-pane drops on the left half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 180, width: 40 },
        overRect: { left: 200, width: 100 },
      }),
    ).toEqual({
      kind: "reorder",
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
    });
  });

  it("returns an after-target insertion index for cross-pane drops on the right half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 280, width: 40 },
        overRect: { left: 200, width: 100 },
      }),
    ).toEqual({
      kind: "reorder",
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
    });
  });

  it("adjusts same-pane drops so insertion indexes match arrayMove semantics", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "pane",
        activeTabId: "b",
        overPaneId: "pane",
        overTabId: "d",
        targetTabs,
        activeRect: { left: 460, width: 40 },
        overRect: { left: 400, width: 100 },
      }),
    ).toEqual({
      kind: "reorder",
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
    });
  });

  it("groups when dropping onto the center of another tab in the same pane", () => {
    // Active center at 250, over tab [200, 300] → relativeX 50 / 100 = center.
    expect(
      computeTabDropPreview({
        activePaneId: "pane",
        activeTabId: "a",
        overPaneId: "pane",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 230, width: 40 },
        overRect: { left: 200, width: 100 },
      }),
    ).toEqual({
      kind: "group",
      paneId: "pane",
      targetTabId: "c",
    });
  });

  it("does not group across panes", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 230, width: 40 },
        overRect: { left: 200, width: 100 },
      })?.kind,
    ).toBe("reorder");
  });
});
