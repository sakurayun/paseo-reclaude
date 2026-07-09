import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type {
  SshHostGroup,
  SshHostInfo,
  SshHostPatch,
  SshHostsConnectResponse,
  SshHostUpsert,
} from "@getpaseo/protocol/messages";
import type { SshHostSubmitPayload } from "@/ssh/ssh-host-form-model";

export function buildSshHostsQueryKey(serverId: string): readonly [string, string] {
  return ["ssh-hosts", serverId];
}

interface SshHostsData {
  hosts: SshHostInfo[];
  groups: SshHostGroup[];
}

export interface UseSshHostsResult {
  hosts: SshHostInfo[];
  groups: SshHostGroup[];
  isLoading: boolean;
  isEnabled: boolean;
  connect: (input: {
    hostId: string;
    cols?: number;
    rows?: number;
  }) => Promise<SshHostsConnectResponse["payload"]>;
  createHost: (payload: SshHostSubmitPayload) => Promise<void>;
  updateHost: (id: string, payload: SshHostSubmitPayload) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
  isSaving: boolean;
  refetch: () => void;
}

// Daemon-global SSH host list, seeded by a one-shot list RPC and kept live via
// the `ssh.hosts.changed` broadcast (mirrors use-port-forwards, but through the
// sanctioned replica-query helper). Gated on the host's sshHosts feature.
export function useSshHosts(serverId: string | null): UseSshHostsResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const isEnabled = useHostFeature(normalizedServerId, "sshHosts");
  const enabled = Boolean(client) && isEnabled;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => buildSshHostsQueryKey(normalizedServerId), [normalizedServerId]);

  const query = useReplicaQuery<SshHostsData>({
    queryKey,
    enabled,
    pushEvent: "ssh.hosts.changed",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listSshHosts();
      return { hosts: payload.hosts ?? [], groups: payload.groups ?? [] };
    },
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("ssh.hosts.changed", (message) => {
      queryClient.setQueryData<SshHostsData>(queryKey, {
        hosts: message.payload.hosts ?? [],
        groups: message.payload.groups ?? [],
      });
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  const connectMutation = useMutation({
    mutationFn: async (input: { hostId: string; cols?: number; rows?: number }) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return client.connectSshHost(input);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: SshHostSubmitPayload) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.createSshHost({
        host: payload.host as SshHostUpsert,
        // create only ever sets a password (never clears), so a string is
        // expected; null/undefined is dropped.
        ...(typeof payload.password === "string" ? { password: payload.password } : {}),
        ...(typeof payload.proxyPassword === "string"
          ? { proxyPassword: payload.proxyPassword }
          : {}),
      });
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: SshHostSubmitPayload }) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.updateSshHost({
        id,
        host: payload.host as SshHostPatch,
        ...(payload.password !== undefined ? { password: payload.password } : {}),
        ...(payload.proxyPassword !== undefined ? { proxyPassword: payload.proxyPassword } : {}),
      });
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.deleteSshHost(id);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  return {
    hosts: query.data?.hosts ?? [],
    groups: query.data?.groups ?? [],
    isLoading: query.isLoading,
    isEnabled,
    connect: (input) => connectMutation.mutateAsync(input),
    createHost: (payload) => createMutation.mutateAsync(payload),
    updateHost: (id, payload) => updateMutation.mutateAsync({ id, payload }),
    deleteHost: (id) => deleteMutation.mutateAsync(id),
    isSaving: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    refetch: () => {
      void query.refetch();
    },
  };
}
