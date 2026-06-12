import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GitLogCommit } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { gitLogQueryKey } from "@/git/query-keys";

export const GIT_LOG_PAGE_SIZE = 50;

interface GitLogPageParam {
  anchor: string | undefined;
  skip: number;
}

interface UseGitLogQueryOptions {
  serverId: string;
  cwd: string;
  enabled: boolean;
}

export function useGitLogQuery({ serverId, cwd, enabled }: UseGitLogQueryOptions) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  // History only changes when the branch tip moves. Watching the pushed
  // checkout-status stream (instead of polling) keeps the log fresh after
  // commits land from agents or other clients, while ignoring noisy
  // dirty-state-only updates.
  const lastTipSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!client || !isConnected || !cwd || !enabled) {
      return;
    }
    return client.on("checkout_status_update", (message) => {
      const payload = message.payload;
      if (payload.cwd !== cwd || !payload.isGit) {
        return;
      }
      const signature = [
        payload.currentBranch ?? "",
        payload.aheadBehind ? `${payload.aheadBehind.ahead}/${payload.aheadBehind.behind}` : "",
        payload.aheadOfOrigin ?? "",
        payload.behindOfOrigin ?? "",
      ].join("|");
      if (lastTipSignatureRef.current === signature) {
        return;
      }
      const isFirstUpdate = lastTipSignatureRef.current === null;
      lastTipSignatureRef.current = signature;
      if (!isFirstUpdate) {
        void queryClient.invalidateQueries({ queryKey: gitLogQueryKey(serverId, cwd) });
      }
    });
  }, [client, isConnected, cwd, enabled, queryClient, serverId]);

  const query = useInfiniteQuery({
    queryKey: gitLogQueryKey(serverId, cwd),
    initialPageParam: { anchor: undefined, skip: 0 } as GitLogPageParam,
    queryFn: async ({ pageParam }) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getCheckoutLog({
        cwd,
        limit: GIT_LOG_PAGE_SIZE,
        anchor: pageParam.anchor,
        skip: pageParam.skip,
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload;
    },
    getNextPageParam: (lastPage, allPages): GitLogPageParam | undefined => {
      if (!lastPage.hasMore || !lastPage.anchor) {
        return undefined;
      }
      const loaded = allPages.reduce((total, page) => total + page.commits.length, 0);
      return { anchor: lastPage.anchor, skip: loaded };
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const commits = useMemo<GitLogCommit[]>(
    () => query.data?.pages.flatMap((page) => page.commits) ?? [],
    [query.data],
  );

  return {
    commits,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
