import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { ProviderUsage, ProviderUsageListPayload } from "./types";
import { providerUsageQueryKey } from "./use-provider-usage";

const RECLAUDE_STATUS_STALE_TIME_MS = 60 * 1000;

export function reclaudeStatusQueryKey(serverId: string | null | undefined) {
  return ["reclaudeStatus", serverId ?? ""] as const;
}

export type ReclaudeLoginResult =
  | { step: "completed" }
  | { step: "mfa_required"; mfaChallengeToken: string };

export interface UseReclaudeResult {
  // Whether the daemon advertises the reclaude usage capability.
  supported: boolean;
  // Whether the Claude provider is currently launched via the reclaude binary.
  active: boolean;
  loggedIn: boolean;
  email: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  login: (params: { email: string; password: string }) => Promise<ReclaudeLoginResult>;
  verifyMfa: (params: { challengeToken: string; code: string }) => Promise<void>;
  logout: () => Promise<void>;
  // force=true bypasses the server-side 5-minute throttle (explicit button);
  // omit/false for automatic triggers so they only sync once per window.
  syncUsage: (options?: { force?: boolean }) => Promise<void>;
}

// Owns the reclaude.ai sign-in state for a host. ReClaude usage is deliberately
// decoupled from the unified provider-usage query: sign-in/out and the manual
// "sync usage" action patch ONLY the Claude entry in place (queryClient.setQueryData)
// and never invalidate the list, so other providers (e.g. Codex) are never
// re-fetched, and ReClaude usage never auto-updates.
export function useReclaude(serverId: string | null | undefined): UseReclaudeResult {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.reclaudeUsage === true,
  );
  const statusKey = useMemo(() => reclaudeStatusQueryKey(serverId), [serverId]);
  const usageKey = useMemo(() => providerUsageQueryKey(serverId), [serverId]);
  const canQuery = Boolean(serverId && client && isConnected && supported);

  const query = useQuery({
    queryKey: statusKey,
    enabled: canQuery,
    staleTime: RECLAUDE_STATUS_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      return client.reclaudeStatus();
    },
  });

  // Replace just the Claude entry in the cached usage list, in place. No refetch,
  // so Codex and friends are untouched and ReClaude data only moves on sync.
  const patchClaudeUsage = useCallback(
    (next: ProviderUsage) => {
      queryClient.setQueryData<ProviderUsageListPayload>(usageKey, (prev) => {
        if (!prev) return prev;
        let found = false;
        const providers = prev.providers.map((p) => {
          if (p.providerId === "claude") {
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

  const login = useCallback(
    async (params: { email: string; password: string }): Promise<ReclaudeLoginResult> => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      const result = await client.reclaudeLogin(params);
      await queryClient.invalidateQueries({ queryKey: statusKey });
      if (result.step === "mfa_required") {
        return { step: "mfa_required", mfaChallengeToken: result.mfaChallengeToken ?? "" };
      }
      return { step: "completed" };
    },
    [client, queryClient, statusKey],
  );

  const verifyMfa = useCallback(
    async (params: { challengeToken: string; code: string }) => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      await client.reclaudeVerifyMfa(params);
      await queryClient.invalidateQueries({ queryKey: statusKey });
    },
    [client, queryClient, statusKey],
  );

  const logout = useCallback(async () => {
    if (!client) {
      throw new Error("Host connection is not ready");
    }
    await client.reclaudeLogout();
    // Reflect the signed-out state on the Claude card without refetching the list.
    patchClaudeUsage({
      providerId: "claude",
      displayName: "Claude",
      status: "unavailable",
      planLabel: null,
      sourceLabel: "ReClaude",
      windows: [],
      balances: [],
      details: [],
      error: null,
    });
    await queryClient.invalidateQueries({ queryKey: statusKey });
  }, [client, patchClaudeUsage, queryClient, statusKey]);

  const syncUsage = useCallback(
    async (options?: { force?: boolean }) => {
      if (!client) {
        throw new Error("Host connection is not ready");
      }
      const { usage } = await client.reclaudeSyncUsage(options);
      patchClaudeUsage(usage);
    },
    [client, patchClaudeUsage],
  );

  return {
    supported,
    active: query.data?.active ?? false,
    loggedIn: query.data?.loggedIn ?? false,
    email: query.data?.email ?? null,
    isLoading: query.isLoading,
    refresh,
    login,
    verifyMfa,
    logout,
    syncUsage,
  };
}
