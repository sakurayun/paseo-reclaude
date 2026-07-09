import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type { SshLogEntry } from "@getpaseo/protocol/messages";

export function buildSshLogsQueryKey(serverId: string): readonly [string, string] {
  return ["ssh-logs", serverId];
}

export interface UseSshLogsResult {
  entries: SshLogEntry[];
  isLoading: boolean;
}

// Connection history, seeded by a one-shot RPC and appended live via
// `ssh.logs.updated` (a single-entry upsert broadcast).
export function useSshLogs(serverId: string | null): UseSshLogsResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const isEnabled = useHostFeature(normalizedServerId, "sshHosts");
  const enabled = Boolean(client) && isEnabled;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => buildSshLogsQueryKey(normalizedServerId), [normalizedServerId]);

  const query = useReplicaQuery<SshLogEntry[]>({
    queryKey,
    enabled,
    pushEvent: "ssh.logs.updated",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listSshLogs();
      return payload.entries ?? [];
    },
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("ssh.logs.updated", (message) => {
      queryClient.setQueryData<SshLogEntry[]>(queryKey, (current) =>
        upsertLogEntry(current, message.payload.entry),
      );
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
  };
}

// Newest-first upsert: replace an existing entry (same id) or prepend a new one.
function upsertLogEntry(current: SshLogEntry[] | undefined, entry: SshLogEntry): SshLogEntry[] {
  const rest = (current ?? []).filter((existing) => existing.id !== entry.id);
  return [entry, ...rest];
}
