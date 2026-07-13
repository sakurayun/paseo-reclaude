import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { ProviderUsage, ProviderUsageListPayload } from "./types";
import { providerUsageQueryKey } from "./use-provider-usage";

const GROK_STATUS_STALE_TIME_MS = 60 * 1000;

export function grokStatusQueryKey(serverId: string | null | undefined) {
  return ["grokStatus", serverId ?? ""] as const;
}

export interface UseGrokResult {
  // Whether the daemon advertises the Grok usage-sync capability.
  supported: boolean;
  authenticated: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
  // force=true bypasses the server-side 5-minute throttle (explicit button);
  // omit/false for automatic triggers so they only sync once per window.
  syncUsage: (options?: { force?: boolean }) => Promise<void>;
}

// Grok Build usage is deliberately decoupled from the unified provider-usage
// query: the manual "sync usage" action patches ONLY the Grok entry in place
// (queryClient.setQueryData) and never invalidates the list, so other providers
// are never re-fetched, and Grok usage never auto-updates on list refresh.
export function useGrok(serverId: string | null | undefined): UseGrokResult {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.grokUsageSync === true,
  );
  const statusKey = useMemo(() => grokStatusQueryKey(serverId), [serverId]);
  const usageKey = useMemo(() => providerUsageQueryKey(serverId), [serverId]);
  const canQuery = Boolean(serverId && client && isConnected && supported);

  const query = useFetchQuery({
    queryKey: statusKey,
    enabled: canQuery,
    dataShape: "value",
    staleTimeMs: GROK_STATUS_STALE_TIME_MS,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      return client.grokStatus();
    },
  });

  const patchGrokUsage = useCallback(
    (next: ProviderUsage) => {
      queryClient.setQueryData<ProviderUsageListPayload>(usageKey, (prev) => {
        if (!prev) return prev;
        let found = false;
        const providers = prev.providers.map((p) => {
          if (p.providerId === "grok") {
            found = true;
            return next;
          }
          return p;
        });
        return { ...prev, providers: found ? providers : [...providers, next] };
      });
    },
    [queryClient, usageKey],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: statusKey });
  }, [queryClient, statusKey]);

  const syncUsage = useCallback(
    async (options?: { force?: boolean }) => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      const { usage } = await client.grokSyncUsage(options);
      patchGrokUsage(usage);
      await queryClient.invalidateQueries({ queryKey: statusKey });
    },
    [client, patchGrokUsage, queryClient, statusKey],
  );

  return {
    supported,
    authenticated: query.data?.authenticated ?? false,
    isLoading: query.isLoading,
    refresh,
    syncUsage,
  };
}
