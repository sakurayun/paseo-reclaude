export const AGENT_READY_ROUTE_CONNECTION_FALLBACK_TIMEOUT_MS = 5_000;

export function shouldFallbackHostAgentReadyRoute(input: {
  agentWorkspaceId: string | null;
  hasHydratedWorkspaces: boolean;
  hasClient: boolean;
  isConnected: boolean;
  connectionFallbackReady: boolean;
}): boolean {
  // While we already know the agent's workspace id, wait for workspace
  // hydration before abandoning the deeplink — the prepared tab is coming.
  if (input.agentWorkspaceId?.trim() && !input.hasHydratedWorkspaces) {
    return false;
  }
  if (input.hasClient && input.isConnected) {
    return false;
  }
  return input.connectionFallbackReady;
}
