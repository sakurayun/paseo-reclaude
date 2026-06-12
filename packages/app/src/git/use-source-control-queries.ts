import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { BranchSuggestionsResponse, StashListResponse } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  gitBranchesQueryKey,
  gitCommitFilesQueryKey,
  gitRefsQueryKey,
  gitStashesQueryKey,
  gitStatusFilesQueryKey,
} from "@/git/query-keys";

export type BranchDetail = NonNullable<
  BranchSuggestionsResponse["payload"]["branchDetails"]
>[number];
export type StashEntry = StashListResponse["payload"]["entries"][number];

interface SourceControlQueryOptions {
  serverId: string;
  cwd: string;
  enabled: boolean;
}

export function useCommitFilesQuery({
  serverId,
  cwd,
  hash,
  enabled,
}: SourceControlQueryOptions & { hash: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  return useQuery({
    queryKey: gitCommitFilesQueryKey(serverId, cwd, hash),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getCommitFiles({ cwd, hash });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.files;
    },
    enabled: enabled && !!client && isConnected && !!cwd && !!hash,
    // A commit's file list is immutable — never refetch once loaded.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useBranchesQuery({ serverId, cwd, enabled }: SourceControlQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  return useQuery({
    queryKey: gitBranchesQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getBranchSuggestions({ cwd, limit: 200 });
      if (payload.error) {
        throw new Error(payload.error);
      }
      const details = payload.branchDetails;
      if (details && details.length > 0) {
        return details;
      }
      return payload.branches.map(
        (name): BranchDetail => ({ name, committerDate: 0, hasLocal: true }),
      );
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Remotes and tags for the repo actions menu pickers. */
export function useGitRefsQuery({ serverId, cwd, enabled }: SourceControlQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  return useQuery({
    queryKey: gitRefsQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.checkoutGitRefs(cwd);
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return { remotes: payload.remotes, tags: payload.tags };
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Per-file porcelain status for the changes section. Polls lightly while
 * enabled so edits made outside the app show up without a manual refresh.
 */
export function useGitStatusFilesQuery({ serverId, cwd, enabled }: SourceControlQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  return useQuery({
    queryKey: gitStatusFilesQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.checkoutGitStatusFiles(cwd);
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return payload.files;
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 3_000,
    refetchInterval: enabled ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useStashesQuery({ serverId, cwd, enabled }: SourceControlQueryOptions) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  return useQuery({
    queryKey: gitStashesQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.stashList(cwd, { paseoOnly: false });
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return payload.entries;
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
