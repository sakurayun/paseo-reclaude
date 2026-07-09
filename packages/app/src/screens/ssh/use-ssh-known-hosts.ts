import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type { SshKnownHostInfo } from "@getpaseo/protocol/messages";

export function buildSshKnownHostsQueryKey(serverId: string): readonly [string, string] {
  return ["ssh-known-hosts", serverId];
}

export interface TrustKnownHostInput {
  host: string;
  port?: number;
  keyType: string;
  publicKeyBase64: string;
}

export interface UseSshKnownHostsResult {
  knownHosts: SshKnownHostInfo[];
  isLoading: boolean;
  deleteKnownHost: (id: string) => Promise<void>;
  importKnownHosts: () => Promise<{ imported: number; skipped: number }>;
  trustKnownHost: (input: TrustKnownHostInput) => Promise<void>;
  isSaving: boolean;
}

export function useSshKnownHosts(serverId: string | null): UseSshKnownHostsResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const isEnabled = useHostFeature(normalizedServerId, "sshHosts");
  const enabled = Boolean(client) && isEnabled;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => buildSshKnownHostsQueryKey(normalizedServerId),
    [normalizedServerId],
  );

  const query = useReplicaQuery<SshKnownHostInfo[]>({
    queryKey,
    enabled,
    pushEvent: "ssh.known_hosts.changed",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listSshKnownHosts();
      return payload.knownHosts ?? [];
    },
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("ssh.known_hosts.changed", (message) => {
      queryClient.setQueryData<SshKnownHostInfo[]>(queryKey, message.payload.knownHosts ?? []);
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.deleteSshKnownHost(id);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.importSshKnownHosts({});
      if (response.error) {
        throw new Error(response.error);
      }
      return { imported: response.imported ?? 0, skipped: response.skipped ?? 0 };
    },
  });

  const trustMutation = useMutation({
    mutationFn: async (input: TrustKnownHostInput) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.trustSshKnownHost(input);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  return {
    knownHosts: query.data ?? [],
    isLoading: query.isLoading,
    deleteKnownHost: (id) => deleteMutation.mutateAsync(id),
    importKnownHosts: () => importMutation.mutateAsync(),
    trustKnownHost: (input) => trustMutation.mutateAsync(input),
    isSaving: deleteMutation.isPending || importMutation.isPending,
  };
}
