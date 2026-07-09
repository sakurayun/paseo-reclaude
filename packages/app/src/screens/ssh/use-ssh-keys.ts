import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type { SshKeyInfo } from "@getpaseo/protocol/messages";

export function buildSshKeysQueryKey(serverId: string): readonly [string, string] {
  return ["ssh-keys", serverId];
}

export interface CreateSshKeyInput {
  label: string;
  privateKey: string;
  publicKey?: string;
  certificate?: string;
  passphrase?: string;
}

export interface UseSshKeysResult {
  keys: SshKeyInfo[];
  isLoading: boolean;
  createKey: (input: CreateSshKeyInput) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  isSaving: boolean;
}

// Daemon-global SSH key list, seeded by a one-shot RPC and kept live via the
// `ssh.keys.changed` broadcast. Metadata only — private material never leaves
// the daemon.
export function useSshKeys(serverId: string | null): UseSshKeysResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const isEnabled = useHostFeature(normalizedServerId, "sshHosts");
  const enabled = Boolean(client) && isEnabled;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => buildSshKeysQueryKey(normalizedServerId), [normalizedServerId]);

  const query = useReplicaQuery<SshKeyInfo[]>({
    queryKey,
    enabled,
    pushEvent: "ssh.keys.changed",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listSshKeys();
      return payload.keys ?? [];
    },
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("ssh.keys.changed", (message) => {
      queryClient.setQueryData<SshKeyInfo[]>(queryKey, message.payload.keys ?? []);
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  const createMutation = useMutation({
    mutationFn: async (input: CreateSshKeyInput) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.createSshKey(input);
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
      const response = await client.deleteSshKey(id);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  return {
    keys: query.data ?? [],
    isLoading: query.isLoading,
    createKey: (input) => createMutation.mutateAsync(input),
    deleteKey: (id) => deleteMutation.mutateAsync(id),
    isSaving: createMutation.isPending || deleteMutation.isPending,
  };
}
