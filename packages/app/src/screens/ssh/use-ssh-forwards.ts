import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import type { SshForwardInfo, SshForwardRuntime } from "@getpaseo/protocol/messages";

export function buildSshForwardsQueryKey(serverId: string): readonly [string, string] {
  return ["ssh-forwards", serverId];
}

interface SshForwardsData {
  forwards: SshForwardInfo[];
  runtime: SshForwardRuntime[];
}

export interface CreateSshForwardInput {
  hostId: string;
  forwardType: "local" | "remote" | "dynamic";
  listenPort: number;
  label?: string;
  bindAddress?: string;
  targetHost?: string;
  targetPort?: number;
  autoStart?: boolean;
}

export interface UseSshForwardsResult {
  forwards: SshForwardInfo[];
  runtimeById: Map<string, SshForwardRuntime>;
  isLoading: boolean;
  createForward: (input: CreateSshForwardInput) => Promise<void>;
  deleteForward: (id: string) => Promise<void>;
  startForward: (id: string) => Promise<void>;
  stopForward: (id: string) => Promise<void>;
  isSaving: boolean;
}

// Daemon-global port-forward rules, seeded by a one-shot RPC and kept live via
// `ssh.forwards.changed` (which carries both rules and runtime status).
export function useSshForwards(serverId: string | null): UseSshForwardsResult {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const isEnabled = useHostFeature(normalizedServerId, "sshHosts");
  const enabled = Boolean(client) && isEnabled;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => buildSshForwardsQueryKey(normalizedServerId),
    [normalizedServerId],
  );

  const query = useReplicaQuery<SshForwardsData>({
    queryKey,
    enabled,
    pushEvent: "ssh.forwards.changed",
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listSshForwards();
      return { forwards: payload.forwards ?? [], runtime: payload.runtime ?? [] };
    },
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("ssh.forwards.changed", (message) => {
      queryClient.setQueryData<SshForwardsData>(queryKey, {
        forwards: message.payload.forwards ?? [],
        runtime: message.payload.runtime ?? [],
      });
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  const runtimeById = useMemo(() => {
    const map = new Map<string, SshForwardRuntime>();
    for (const entry of query.data?.runtime ?? []) {
      map.set(entry.id, entry);
    }
    return map;
  }, [query.data]);

  const createMutation = useMutation({
    mutationFn: async (input: CreateSshForwardInput) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.createSshForward(input);
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
      const response = await client.deleteSshForward(id);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const response = await client.startSshForward(id);
      if (response.error) {
        throw new Error(response.error);
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      await client.stopSshForward(id);
    },
  });

  return {
    forwards: query.data?.forwards ?? [],
    runtimeById,
    isLoading: query.isLoading,
    createForward: (input) => createMutation.mutateAsync(input),
    deleteForward: (id) => deleteMutation.mutateAsync(id),
    startForward: (id) => startMutation.mutateAsync(id),
    stopForward: (id) => stopMutation.mutateAsync(id),
    isSaving: createMutation.isPending || deleteMutation.isPending,
  };
}
