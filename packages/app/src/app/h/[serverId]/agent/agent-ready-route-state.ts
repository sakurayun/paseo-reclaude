export const AGENT_READY_ROUTE_CONNECTION_FALLBACK_TIMEOUT_MS = 5_000;

export function shouldFallbackHostAgentReadyRoute(input: {
  agentCwd: string | null;
  hasHydratedWorkspaces: boolean;
  hasClient: boolean;
  isConnected: boolean;
  connectionFallbackReady: boolean;
}): boolean {
  if (input.agentCwd?.trim() && !input.hasHydratedWorkspaces) {
    return false;
  }
  if (input.hasClient && input.isConnected) {
    return false;
  }
  return input.connectionFallbackReady;
}
