import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { resolveTabDropKind } from "@/workspace-tabs/tab-groups";

export type TabDropPreview =
  | {
      kind: "reorder";
      paneId: string;
      insertionIndex: number;
      indicatorIndex: number;
    }
  | {
      kind: "group";
      paneId: string;
      targetTabId: string;
    };

interface ComputeTabDropPreviewInput {
  activePaneId: string;
  activeTabId: string;
  overPaneId: string;
  overTabId: string;
  targetTabs: WorkspaceTabDescriptor[];
  activeRect: {
    left: number;
    width: number;
  };
  overRect: {
    left: number;
    width: number;
  };
}

export function computeTabDropPreview(input: ComputeTabDropPreviewInput): TabDropPreview | null {
  const targetIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.overTabId);
  if (targetIndex < 0 || input.overRect.width <= 0) {
    return null;
  }

  const activeCenterX = input.activeRect.left + input.activeRect.width / 2;
  const relativeX = activeCenterX - input.overRect.left;

  // Grouping only within the same pane (Edge-style band of tabs).
  if (
    input.activePaneId === input.overPaneId &&
    input.activeTabId !== input.overTabId &&
    resolveTabDropKind({
      relativeX,
      overWidth: input.overRect.width,
      isSameTab: false,
    }) === "group"
  ) {
    return {
      kind: "group",
      paneId: input.overPaneId,
      targetTabId: input.overTabId,
    };
  }

  const overCenterX = input.overRect.left + input.overRect.width / 2;
  const insertAfterTarget = activeCenterX >= overCenterX;

  const indicatorIndex = targetIndex + (insertAfterTarget ? 1 : 0);
  let insertionIndex = indicatorIndex;
  if (input.activePaneId === input.overPaneId) {
    const sourceIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.activeTabId);
    if (sourceIndex < 0) {
      return null;
    }
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    insertionIndex = Math.max(0, Math.min(input.targetTabs.length - 1, insertionIndex));
  }

  return {
    kind: "reorder",
    paneId: input.overPaneId,
    insertionIndex,
    indicatorIndex,
  };
}
