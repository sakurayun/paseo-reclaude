import { describe, expect, it } from "vitest";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import {
  collectAllTabs,
  createDefaultLayout,
  openTabInLayoutFocused,
  removeTransientTabsFromLayout,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

describe("ssh-connecting tab identity", () => {
  it("builds a deterministic tab id from the connectId", () => {
    expect(buildDeterministicWorkspaceTabId({ kind: "ssh-connecting", connectId: "c1" })).toBe(
      "ssh-connecting_c1",
    );
  });

  it("normalizes and compares by connectId", () => {
    expect(normalizeWorkspaceTabTarget({ kind: "ssh-connecting", connectId: " c1 " })).toEqual({
      kind: "ssh-connecting",
      connectId: "c1",
    });
    expect(normalizeWorkspaceTabTarget({ kind: "ssh-connecting", connectId: "  " })).toBeNull();
    expect(
      workspaceTabTargetsEqual(
        { kind: "ssh-connecting", connectId: "c1" },
        { kind: "ssh-connecting", connectId: "c1" },
      ),
    ).toBe(true);
    expect(
      workspaceTabTargetsEqual(
        { kind: "ssh-connecting", connectId: "c1" },
        { kind: "ssh-connecting", connectId: "c2" },
      ),
    ).toBe(false);
  });
});

describe("removeTransientTabsFromLayout", () => {
  function layoutWith(...targets: Parameters<typeof openTabInLayoutFocused>[0]["target"][]) {
    let layout: WorkspaceLayout = createDefaultLayout();
    for (const target of targets) {
      layout = openTabInLayoutFocused({ layout, target, now: 1 }).layout;
    }
    return layout;
  }

  it("drops ssh-connecting tabs and keeps the rest", () => {
    const layout = layoutWith(
      { kind: "terminal", terminalId: "t1" },
      { kind: "ssh-connecting", connectId: "c1" },
    );
    const cleaned = removeTransientTabsFromLayout(layout);
    const kinds = collectAllTabs(cleaned.root).map((tab) => tab.target.kind);
    expect(kinds).toContain("terminal");
    expect(kinds).not.toContain("ssh-connecting");
  });

  it("is a no-op when there are no transient tabs", () => {
    const layout = layoutWith({ kind: "terminal", terminalId: "t1" });
    expect(removeTransientTabsFromLayout(layout)).toBe(layout);
  });
});
