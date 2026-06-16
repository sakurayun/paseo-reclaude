import { describe, expect, it } from "vitest";
import { shouldSeedEmptyWorkspaceDraft } from "./workspace-empty-draft-seed";

const readyEmptyWorkspace = {
  isRouteFocused: true,
  hasPersistenceKey: true,
  hasWorkspaceDirectory: true,
  hasHydratedWorkspaceLayoutStore: true,
  hasHydratedAgents: true,
  hasLoadedTerminals: true,
  activeAgentCount: 0,
  terminalCount: 0,
  tabCount: 0,
};

describe("shouldSeedEmptyWorkspaceDraft", () => {
  it("waits for refresh-time hydration before seeding a draft", () => {
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasHydratedWorkspaceLayoutStore: false,
      }),
    ).toBe(false);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasHydratedAgents: false,
      }),
    ).toBe(false);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        hasLoadedTerminals: false,
      }),
    ).toBe(false);
  });

  it("does not seed when a tab is already open", () => {
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        tabCount: 1,
      }),
    ).toBe(false);
  });

  it("seeds an empty pane even when idle agents or terminals exist but have no open tabs", () => {
    // Regression: the startup "restore only running sessions" prune can leave a workspace
    // with idle agents (activeAgentCount > 0) but zero tabs, which previously rendered a
    // blank pane (white screen on switch, crash-looking empty state on relaunch). An empty
    // focused pane must always fall back to a fresh draft.
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        activeAgentCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldSeedEmptyWorkspaceDraft({
        ...readyEmptyWorkspace,
        terminalCount: 1,
      }),
    ).toBe(true);
  });

  it("seeds once an empty focused workspace is fully known", () => {
    expect(shouldSeedEmptyWorkspaceDraft(readyEmptyWorkspace)).toBe(true);
  });
});
