import { useMemo } from "react";
import { useReplicaQuery } from "@/data/query";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import {
  buildTerminalsQueryKey,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";

export type HostTerminalEntry = ListTerminalsPayload["terminals"][number];

/**
 * Host-wide terminal list for the sidebar: every terminal on the daemon,
 * across all workspaces, kept live via the "" (host-root) terminals
 * subscription. Gated on the daemon's terminalLifecycle capability — old
 * daemons neither retain exited terminals nor accept the host-root cwd.
 */
export function useHostTerminals(serverId: string | null): {
  terminals: HostTerminalEntry[];
  supportsTerminalLifecycle: boolean;
} {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useSessionStore((state) =>
    normalizedServerId ? (state.sessions[normalizedServerId]?.client ?? null) : null,
  );
  const supportsTerminalLifecycle = useHostFeature(normalizedServerId, "terminalLifecycle");
  const enabled = Boolean(client) && supportsTerminalLifecycle;

  const query = useReplicaQuery({
    queryKey: buildTerminalsQueryKey(normalizedServerId, "", null),
    enabled,
    pushEvent: "terminals_changed",
    meta: workspaceTerminalsPushRoute({
      enabled,
      serverId: normalizedServerId,
      cwd: "",
    }),
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      return await client.listTerminals();
    },
  });

  const terminals = useMemo(() => query.data?.terminals ?? [], [query.data]);
  return { terminals, supportsTerminalLifecycle };
}
