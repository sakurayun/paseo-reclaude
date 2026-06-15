import type { Query, QueryClient } from "@tanstack/react-query";
import { prPaneTimelineQueryKind } from "./pull-request-panel/query-keys";

interface CheckoutQueryIdentity {
  serverId: string;
  cwd: string;
}

interface CheckoutQueryScope {
  serverId: string;
  cwd?: string;
}

type CheckoutQueryKey = readonly unknown[];

export function checkoutStatusQueryKey(serverId: string, cwd: string) {
  return ["checkoutStatus", serverId, cwd] as const;
}

export function checkoutDiffQueryKey(
  serverId: string,
  cwd: string,
  mode: "uncommitted" | "base",
  baseRef?: string,
  ignoreWhitespace?: boolean,
) {
  return ["checkoutDiff", serverId, cwd, mode, baseRef ?? "", ignoreWhitespace === true] as const;
}

export function gitLogQueryKey(serverId: string, cwd: string) {
  return ["gitLog", serverId, cwd] as const;
}

export function gitCommitFilesQueryKey(serverId: string, cwd: string, hash: string) {
  return ["gitCommitFiles", serverId, cwd, hash] as const;
}

export function gitBranchesQueryKey(serverId: string, cwd: string) {
  return ["gitBranches", serverId, cwd] as const;
}

export function gitStashesQueryKey(serverId: string, cwd: string) {
  return ["gitStashes", serverId, cwd] as const;
}

export function gitRefsQueryKey(serverId: string, cwd: string) {
  return ["gitRefs", serverId, cwd] as const;
}

export function gitStatusFilesQueryKey(serverId: string, cwd: string) {
  return ["gitStatusFiles", serverId, cwd] as const;
}

export function checkoutPrStatusQueryKey(serverId: string, cwd: string) {
  return ["checkoutPrStatus", serverId, cwd] as const;
}

export async function invalidateCheckoutGitQueriesForClient(
  queryClient: QueryClient,
  identity: CheckoutQueryIdentity,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: checkoutStatusQueryKey(identity.serverId, identity.cwd),
    }),
    invalidateSourceControlDataQueries(queryClient, identity),
  ]);
}

/**
 * Invalidate the source-control data queries (history, diffs, file lists)
 * without touching the checkout status query itself. Used when a pushed
 * checkout_status_update already carries the fresh status: re-fetching it
 * would be redundant, but the dependent views must converge.
 */
export async function invalidateSourceControlDataQueries(
  queryClient: QueryClient,
  identity: CheckoutQueryIdentity,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("checkoutDiff", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("checkoutPrStatus", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate(prPaneTimelineQueryKind, identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("gitLog", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("gitBranches", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("gitStashes", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("gitRefs", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("gitStatusFiles", identity),
    }),
  ]);
}

// checkoutDiff is excluded: diff queries are subscription-fed (queryFn: skipToken) and
// receive a fresh snapshot on every resubscribe, so invalidation cannot and need not
// refetch them.
export async function invalidateCheckoutGitQueriesForServer(
  queryClient: QueryClient,
  serverId: string,
) {
  const kinds = ["checkoutStatus", "checkoutPrStatus", prPaneTimelineQueryKind];
  await Promise.all(
    kinds.map((kind) =>
      queryClient.invalidateQueries({ predicate: checkoutQueryPredicate(kind, { serverId }) }),
    ),
  );
}

export async function invalidatePrPaneTimelineForCheckout(
  queryClient: QueryClient,
  identity: CheckoutQueryIdentity,
) {
  await queryClient.invalidateQueries({
    predicate: checkoutQueryPredicate(prPaneTimelineQueryKind, identity),
  });
}

function checkoutQueryPredicate(
  queryKind: CheckoutQueryKey[0],
  scope: CheckoutQueryScope,
): (query: Query) => boolean {
  return (query) => {
    const key = query.queryKey;
    return (
      isCheckoutQueryKey(key) &&
      key[0] === queryKind &&
      key[1] === scope.serverId &&
      (scope.cwd === undefined || key[2] === scope.cwd)
    );
  };
}

function isCheckoutQueryKey(key: readonly unknown[]): key is CheckoutQueryKey {
  return (
    key.length >= 3 &&
    typeof key[0] === "string" &&
    typeof key[1] === "string" &&
    typeof key[2] === "string"
  );
}
