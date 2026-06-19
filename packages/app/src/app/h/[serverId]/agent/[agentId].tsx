import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import {
  AGENT_READY_ROUTE_CONNECTION_FALLBACK_TIMEOUT_MS,
  shouldFallbackHostAgentReadyRoute,
} from "./agent-ready-route-state";

// Catch render-time crashes in the full-screen agent subtree (e.g. opening a
// history session) so they surface as a recoverable error screen instead of a
// white screen / launch crash. See components/route-error-boundary.tsx.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/route-error-boundary";
import { navigateToAgent } from "@/utils/navigate-to-agent";

export default function HostAgentReadyRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostAgentReadyRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostAgentReadyRouteContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{
    serverId?: string;
    agentId?: string;
  }>();
  const redirectedRef = useRef(false);
  const [connectionFallbackReady, setConnectionFallbackReady] = useState(false);
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agentWorkspaceId = useSessionStore((state) => {
    if (!serverId || !agentId) {
      return null;
    }
    return state.sessions[serverId]?.agents?.get(agentId)?.workspaceId ?? null;
  });
  const hasHydratedWorkspaces = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false,
  );
  const resolvedWorkspaceId = normalizeWorkspaceOpaqueId(agentWorkspaceId);

  useEffect(() => {
    setConnectionFallbackReady(false);
  }, [agentId, serverId]);

  useEffect(() => {
    if (!serverId || !agentId || redirectedRef.current) {
      return;
    }
    if (client && isConnected) {
      setConnectionFallbackReady(false);
      return;
    }

    setConnectionFallbackReady(false);
    const handle = setTimeout(() => {
      setConnectionFallbackReady(true);
    }, AGENT_READY_ROUTE_CONNECTION_FALLBACK_TIMEOUT_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [agentId, client, isConnected, serverId]);

  useEffect(() => {
    if (redirectedRef.current) {
      return;
    }
    if (!serverId || !agentId) {
      redirectedRef.current = true;
      router.replace("/" as Href);
      return;
    }

    if (resolvedWorkspaceId) {
      redirectedRef.current = true;
      navigateToAgent({
        serverId,
        agentId,
        currentPathname: pathname,
      });
    }
  }, [agentId, pathname, resolvedWorkspaceId, router, serverId]);

  useEffect(() => {
    if (redirectedRef.current) {
      return;
    }
    if (!serverId || !agentId) {
      return;
    }
    // Fork-only: keep the connection grace period from the Android notification
    // deeplink fix instead of upstream's immediate redirect, so a cold-start
    // deeplink doesn't bounce to root before the host runtime finishes
    // connecting. Adapted to workspace-by-ID (was cwd-based).
    if (
      shouldFallbackHostAgentReadyRoute({
        agentWorkspaceId,
        hasHydratedWorkspaces,
        hasClient: Boolean(client),
        isConnected,
        connectionFallbackReady,
      })
    ) {
      redirectedRef.current = true;
      router.replace(buildHostRootRoute(serverId));
    }
  }, [
    agentWorkspaceId,
    agentId,
    client,
    connectionFallbackReady,
    hasHydratedWorkspaces,
    isConnected,
    router,
    serverId,
  ]);

  useEffect(() => {
    if (redirectedRef.current) {
      return;
    }
    if (!serverId || !agentId || !client || !isConnected) {
      return;
    }

    let cancelled = false;
    void client
      .fetchAgent(agentId)
      .then((result) => {
        if (cancelled || redirectedRef.current) {
          return;
        }
        const workspaceId = normalizeWorkspaceOpaqueId(result?.agent?.workspaceId);
        redirectedRef.current = true;
        if (workspaceId) {
          navigateToAgent({
            serverId,
            agentId,
            workspaceId,
            currentPathname: pathname,
          });
          return;
        }
        router.replace(buildHostRootRoute(serverId));
        return;
      })
      .catch(() => {
        if (cancelled || redirectedRef.current) {
          return;
        }
        redirectedRef.current = true;
        router.replace(buildHostRootRoute(serverId));
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, client, isConnected, pathname, router, serverId]);

  return null;
}
