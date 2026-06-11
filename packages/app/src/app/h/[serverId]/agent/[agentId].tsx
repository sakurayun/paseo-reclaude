import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useSessionStore } from "@/stores/session-store";
import { useResolveWorkspaceIdByCwd } from "@/stores/session-store-hooks";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import {
  AGENT_READY_ROUTE_CONNECTION_FALLBACK_TIMEOUT_MS,
  shouldFallbackHostAgentReadyRoute,
} from "./agent-ready-route-state";

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
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  const isConnected = connectionStatus === "online";
  const agentCwd = useSessionStore((state) => {
    if (!serverId || !agentId) {
      return null;
    }
    return state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? null;
  });
  const hasHydratedWorkspaces = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false,
  );
  const resolvedWorkspaceId = useResolveWorkspaceIdByCwd(serverId, agentCwd);

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
      navigateToPreparedWorkspaceTab({
        serverId,
        workspaceId: resolvedWorkspaceId,
        target: { kind: "agent", agentId },
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
    if (
      shouldFallbackHostAgentReadyRoute({
        agentCwd,
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
    agentCwd,
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
        const cwd = result?.agent?.cwd?.trim();
        const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
        const workspaceId = resolveWorkspaceIdByExecutionDirectory({
          workspaces: workspaces?.values(),
          workspaceDirectory: cwd,
        });
        if (!workspaceId && !hasHydratedWorkspaces) {
          return;
        }
        redirectedRef.current = true;
        if (workspaceId) {
          navigateToPreparedWorkspaceTab({
            serverId,
            workspaceId,
            target: { kind: "agent", agentId },
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
  }, [agentId, client, hasHydratedWorkspaces, isConnected, pathname, router, serverId]);

  return null;
}
