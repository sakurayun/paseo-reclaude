import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PortForwardInfo } from "@getpaseo/protocol/messages";

/**
 * Data layer for the daemon-global port-forward list. The list is keyed only by
 * serverId (forwards target the daemon host, not any one workspace), seeded with
 * a one-shot list RPC, then kept in sync across every connected client by the
 * `port_forward.changed` broadcast. Create/delete go through the daemon, which
 * persists and re-broadcasts — so a forward added on one device shows up on all.
 */

export function buildPortForwardsQueryKey(serverId: string): readonly [string, string] {
  return ["port-forwards", serverId];
}

interface UsePortForwardsInput {
  client: DaemonClient | null;
  serverId: string;
}

export interface CreatePortForwardVars {
  localPort: number;
  remotePort: number;
  label?: string;
}

export function usePortForwards(input: UsePortForwardsInput) {
  const { client, serverId } = input;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => buildPortForwardsQueryKey(serverId), [serverId]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(client),
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.listPortForwards();
      return payload.forwards;
    },
  });

  const forwards = useMemo<PortForwardInfo[]>(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsubscribe = client.on("port_forward.changed", (message) => {
      queryClient.setQueryData<PortForwardInfo[]>(queryKey, message.payload.forwards);
    });
    return () => {
      unsubscribe();
    };
  }, [client, queryClient, queryKey]);

  const createMutation = useMutation({
    mutationFn: async (vars: CreatePortForwardVars) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.createPortForward(vars);
      if (!payload.forward && payload.error) {
        throw new Error(payload.error);
      }
      return payload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.deletePortForward(id);
      if (!payload.success && payload.error) {
        throw new Error(payload.error);
      }
      return payload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return { forwards, query, createMutation, deleteMutation };
}
