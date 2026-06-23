import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { queryClient as appQueryClient } from "@/query/query-client";
import type { ProviderUsageListPayload } from "./types";
import { providerUsageQueryKey } from "./use-provider-usage";
import { reclaudeStatusQueryKey } from "./use-reclaude";

// COMPAT(reclaudeUsageBroadcast): added in v0.1.108, remove gate after 2026-12-23.
// The reclaude session cookie + cached usage snapshot live on the daemon and are
// shared by every client. A login / logout / "sync usage" on any device mutates
// that shared state, but responses are per-connection, so other clients used to
// only catch up on their own staleTime. This bridge listens for the daemon's
// `provider.reclaude.changed` broadcast and live-patches the local React Query
// caches (reclaude status + the Claude entry of the provider-usage list), exactly
// as the originating client's own handlers do. No daemon round-trip; old daemons
// never send the event so the bridge stays a pure no-op.
export function startReclaudeUsageSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;

  return client.on("provider.reclaude.changed", (msg) => {
    if (msg.type !== "provider.reclaude.changed") {
      return;
    }
    const { active, loggedIn, email, usage } = msg.payload;

    // Reflect the shared auth state without a refetch.
    appQueryClient.setQueryData(reclaudeStatusQueryKey(serverId), { active, loggedIn, email });

    // Patch just the Claude entry in the cached usage list, in place, so other
    // providers (e.g. Codex) are untouched — mirroring useReclaude's patchClaudeUsage.
    if (!usage) {
      return;
    }
    appQueryClient.setQueryData<ProviderUsageListPayload>(
      providerUsageQueryKey(serverId),
      (prev) => {
        if (!prev) {
          return prev;
        }
        let found = false;
        const providers = prev.providers.map((provider) => {
          if (provider.providerId === "claude") {
            found = true;
            return usage;
          }
          return provider;
        });
        return { ...prev, providers: found ? providers : [...providers, usage] };
      },
    );
  });
}
