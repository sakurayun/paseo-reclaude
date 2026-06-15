import type { QueryClient } from "@tanstack/react-query";
import type { CheckoutStatusResponse, CheckoutStatusUpdate } from "@getpaseo/protocol/messages";
import { checkoutStatusQueryKey, invalidateSourceControlDataQueries } from "@/git/query-keys";

export type CheckoutStatusPayload = CheckoutStatusResponse["payload"];

export interface CheckoutStatusClient {
  getCheckoutStatus: (cwd: string) => Promise<CheckoutStatusPayload>;
}

export async function peekOrFetchCheckoutStatus({
  queryClient,
  client,
  serverId,
  cwd,
}: {
  queryClient: QueryClient;
  client: CheckoutStatusClient;
  serverId: string;
  cwd: string;
}): Promise<CheckoutStatusPayload> {
  const queryKey = checkoutStatusQueryKey(serverId, cwd);
  const cached = queryClient.getQueryData<CheckoutStatusPayload>(queryKey);
  if (cached) {
    return cached;
  }

  const snapshot = await client.getCheckoutStatus(cwd);
  queryClient.setQueryData(queryKey, snapshot);
  return snapshot;
}

/**
 * Compare two status payloads ignoring the requestId (the push channel uses a
 * fixed synthetic one), so only real git-state changes count as different.
 */
function checkoutStatusesEquivalent(
  left: CheckoutStatusPayload,
  right: CheckoutStatusPayload,
): boolean {
  const normalize = (payload: CheckoutStatusPayload) =>
    JSON.stringify({ ...payload, requestId: null });
  return normalize(left) === normalize(right);
}

export function applyCheckoutStatusUpdate({
  queryClient,
  serverId,
  cwd,
  message,
}: {
  queryClient: QueryClient;
  serverId: string;
  cwd: string;
  message: CheckoutStatusUpdate;
}): void {
  if (message.payload.cwd !== cwd) {
    return;
  }
  const queryKey = checkoutStatusQueryKey(serverId, cwd);
  const previous = queryClient.getQueryData<CheckoutStatusPayload>(queryKey);
  queryClient.setQueryData(queryKey, message.payload);

  // The daemon pushes this update to every connected client (local sockets
  // and relay tunnels alike) whenever the repo changes — including changes
  // made from other clients or terminals. Refresh the dependent
  // source-control queries so every client's panel converges. The setQueryData
  // above makes repeat deliveries of the same snapshot compare equal, so
  // multiple subscribed components don't fan out duplicate invalidations.
  if (previous && !checkoutStatusesEquivalent(previous, message.payload)) {
    void invalidateSourceControlDataQueries(queryClient, { serverId, cwd });
  }
}
