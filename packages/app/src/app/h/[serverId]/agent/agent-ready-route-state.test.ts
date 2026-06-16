import { describe, expect, it } from "vitest";

import { shouldFallbackHostAgentReadyRoute } from "./agent-ready-route-state";

describe("shouldFallbackHostAgentReadyRoute", () => {
  it("waits for the host connection before abandoning an agent deeplink", () => {
    expect(
      shouldFallbackHostAgentReadyRoute({
        agentWorkspaceId: null,
        hasHydratedWorkspaces: false,
        hasClient: false,
        isConnected: false,
        connectionFallbackReady: false,
      }),
    ).toBe(false);
  });

  it("falls back only after the connection grace period is ready", () => {
    expect(
      shouldFallbackHostAgentReadyRoute({
        agentWorkspaceId: null,
        hasHydratedWorkspaces: false,
        hasClient: false,
        isConnected: false,
        connectionFallbackReady: true,
      }),
    ).toBe(true);
  });

  it("does not fall back while a known agent workspace id waits for workspace hydration", () => {
    expect(
      shouldFallbackHostAgentReadyRoute({
        agentWorkspaceId: "ws-1",
        hasHydratedWorkspaces: false,
        hasClient: false,
        isConnected: false,
        connectionFallbackReady: true,
      }),
    ).toBe(false);
  });

  it("does not fall back once the host connection is online", () => {
    expect(
      shouldFallbackHostAgentReadyRoute({
        agentWorkspaceId: null,
        hasHydratedWorkspaces: true,
        hasClient: true,
        isConnected: true,
        connectionFallbackReady: true,
      }),
    ).toBe(false);
  });
});
