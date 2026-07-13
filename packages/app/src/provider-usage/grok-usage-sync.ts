import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { queryClient as appQueryClient } from "@/data/query-client";
import type { ProviderUsageListPayload } from "./types";
import { providerUsageQueryKey } from "./use-provider-usage";
import { grokStatusQueryKey } from "./use-grok";

// COMPAT(grokUsageBroadcast): added in v0.1.125, remove gate after 2027-01-13.
// The Grok usage cache lives on the daemon and is shared by every client. A
// "sync usage" on any device mutates that shared state; this bridge listens for
// `provider.grok.changed` and live-patches the local React Query caches.
export function startGrokUsageSync(params: { serverId: string; client: DaemonClient }): () => void {
  const { serverId, client } = params;

  return client.on("provider.grok.changed", (msg) => {
    if (msg.type !== "provider.grok.changed") {
      return;
    }
    const { authenticated, usage } = msg.payload;

    appQueryClient.setQueryData(grokStatusQueryKey(serverId), { authenticated });

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
          if (provider.providerId === "grok") {
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
