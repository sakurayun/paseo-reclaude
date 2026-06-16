export function shouldSeedEmptyWorkspaceDraft(input: {
  isRouteFocused: boolean;
  hasPersistenceKey: boolean;
  hasWorkspaceDirectory: boolean;
  hasHydratedWorkspaceLayoutStore: boolean;
  hasHydratedAgents: boolean;
  hasLoadedTerminals: boolean;
  activeAgentCount: number;
  terminalCount: number;
  tabCount: number;
}): boolean {
  if (
    !input.isRouteFocused ||
    !input.hasPersistenceKey ||
    !input.hasWorkspaceDirectory ||
    !input.hasHydratedWorkspaceLayoutStore ||
    !input.hasHydratedAgents ||
    !input.hasLoadedTerminals
  ) {
    return false;
  }

  // A focused, fully-hydrated workspace must never render an empty pane. The startup
  // "restore only running sessions" prune can close every tab while idle/ended agents
  // still exist (so activeAgentCount > 0), which previously left a blank pane (white
  // screen on switch, and the same empty state when restored on relaunch). Seed a fresh
  // draft whenever there are no tabs to show.
  return input.tabCount === 0;
}
