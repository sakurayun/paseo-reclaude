import type { QueryClient } from "@tanstack/react-query";
import type { CheckoutStatusResponse, CheckoutStatusUpdate } from "@getpaseo/protocol/messages";
import equal from "fast-deep-equal/es6";
import {
  checkoutPrStatusQueryKey,
  checkoutStatusQueryKey,
  invalidatePrPaneTimelineForCheckout,
  invalidateSourceControlDataQueries,
} from "@/git/query-keys";
import { expireStaleDiffModeOverrides } from "@/review/store";

export type CheckoutStatusPayload = CheckoutStatusResponse["payload"];
export type CheckoutPrStatusPayload = NonNullable<CheckoutStatusUpdate["payload"]["prStatus"]>;

export interface CheckoutStatusClient {
  getCheckoutStatus: (cwd: string) => Promise<CheckoutStatusPayload>;
}

// Checkout status enters the app through exactly two doors: daemon pushes
// (applyCheckoutStatusUpdateFromEvent) and query fetches (fetchCheckoutStatus). Both run
// the dirty-state reactions, so they hold regardless of which screens are mounted.

export async function fetchCheckoutStatus({
  client,
  serverId,
  cwd,
}: {
  client: CheckoutStatusClient;
  serverId: string;
  cwd: string;
}): Promise<CheckoutStatusPayload> {
  const payload = await client.getCheckoutStatus(cwd);
  expireStaleDiffModeOverrides({ serverId, cwd, isDirty: payload.isGit && payload.isDirty });
  return payload;
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

export function applyCheckoutStatusUpdateFromEvent({
  queryClient,
  serverId,
  message,
}: {
  queryClient: QueryClient;
  serverId: string;
  message: CheckoutStatusUpdate;
}): void {
  const { payload } = message;
  const queryKey = checkoutStatusQueryKey(serverId, payload.cwd);
  const previous = queryClient.getQueryData<CheckoutStatusPayload>(queryKey);
  queryClient.setQueryData(queryKey, payload);
  expireStaleDiffModeOverrides({
    serverId,
    cwd: payload.cwd,
    isDirty: payload.isGit && payload.isDirty,
  });

  // The daemon pushes this update to every connected client (local sockets
  // and relay tunnels alike) whenever the repo changes — including changes
  // made from other clients or terminals. Refresh the dependent
  // source-control queries so every client's panel converges. The setQueryData
  // above makes repeat deliveries of the same snapshot compare equal, so
  // multiple subscribed components don't fan out duplicate invalidations.
  if (previous && !checkoutStatusesEquivalent(previous, payload)) {
    void invalidateSourceControlDataQueries(queryClient, { serverId, cwd: payload.cwd });
  }

  const prStatus = payload.prStatus;
  if (!prStatus) {
    return;
  }

  const previousPrStatus = queryClient.getQueryData<CheckoutPrStatusPayload>(
    checkoutPrStatusQueryKey(serverId, prStatus.cwd),
  );
  queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, prStatus.cwd), prStatus);

  // The PR activity timeline has no push channel; mark it stale when the pushed PR status
  // meaningfully changed. Active panes refetch immediately, evicted ones on next mount.
  if (hasPrStatusChanged(previousPrStatus, prStatus)) {
    void invalidatePrPaneTimelineForCheckout(queryClient, { serverId, cwd: prStatus.cwd });
  }
}

// requestId changes on every emission and carries no PR state.
function prStatusWithoutVolatileFields(
  prStatus: CheckoutPrStatusPayload,
): Omit<CheckoutPrStatusPayload, "requestId"> {
  const { requestId: _requestId, ...rest } = prStatus;
  return rest;
}

function hasPrStatusChanged(
  previous: CheckoutPrStatusPayload | undefined,
  next: CheckoutPrStatusPayload,
): boolean {
  if (!previous) {
    return true;
  }
  return !equal(prStatusWithoutVolatileFields(previous), prStatusWithoutVolatileFields(next));
}
