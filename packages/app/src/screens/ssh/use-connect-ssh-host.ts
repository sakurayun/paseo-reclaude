import { useCallback, useState } from "react";
import type { SshObservedHostKey } from "@getpaseo/protocol/messages";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSshKnownHosts } from "@/screens/ssh/use-ssh-known-hosts";
import { registerSshTerminal } from "@/stores/ssh-terminal-meta-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import {
  getLastWorkspaceSelection,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";

export interface UseConnectSshHostResult {
  connectHost: (hostId: string) => Promise<void>;
  connectingHostId: string | null;
  mismatch: { hostId: string; key: SshObservedHostKey } | null;
  trustAndReconnect: () => Promise<void>;
  closeMismatch: () => void;
  // True when the server has no workspace to host the SSH terminal tab.
  noWorkspace: boolean;
}

// Resolves the workspace whose tab bar should host the SSH terminal: the
// last-active workspace on this server if any, else its first known workspace.
function resolveTargetWorkspaceId(serverId: string): string | null {
  const last = getLastWorkspaceSelection();
  if (last && last.serverId === serverId) {
    return last.workspaceId;
  }
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  if (workspaces && workspaces.size > 0) {
    return [...workspaces.keys()][0] ?? null;
  }
  return null;
}

// Connects to an SSH host and opens its terminal as a tab in the active
// workspace's tab bar — reusing the workspace terminal panel + draggable tabs.
export function useConnectSshHost(serverId: string | null): UseConnectSshHostResult {
  const { hosts, connect } = useSshHosts(serverId);
  const { trustKnownHost } = useSshKnownHosts(serverId);
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ hostId: string; key: SshObservedHostKey } | null>(
    null,
  );
  const [noWorkspace, setNoWorkspace] = useState(false);

  const connectHost = useCallback(
    async (hostId: string) => {
      if (!serverId) {
        return;
      }
      const workspaceId = resolveTargetWorkspaceId(serverId);
      if (!workspaceId) {
        setNoWorkspace(true);
        return;
      }
      setNoWorkspace(false);
      const host = hosts.find((entry) => entry.id === hostId);
      setConnectingHostId(hostId);
      try {
        const payload = await connect({ hostId });
        if (payload.terminal) {
          registerSshTerminal(payload.terminal.id, {
            hostId,
            label: host?.label || host?.address || payload.terminal.name,
          });
          navigateToWorkspace(serverId, workspaceId);
          const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
          if (workspaceKey) {
            useWorkspaceLayoutStore
              .getState()
              .openTabFocused(workspaceKey, { kind: "terminal", terminalId: payload.terminal.id });
          }
        } else if (payload.code === "host_key_mismatch" && payload.observedKey) {
          setMismatch({ hostId, key: payload.observedKey });
        }
      } finally {
        setConnectingHostId(null);
      }
    },
    [connect, hosts, serverId],
  );

  const closeMismatch = useCallback(() => setMismatch(null), []);
  const trustAndReconnect = useCallback(async () => {
    if (!mismatch) {
      return;
    }
    const { hostId, key } = mismatch;
    await trustKnownHost({
      host: key.host,
      ...(key.port !== undefined ? { port: key.port } : {}),
      keyType: key.keyType,
      publicKeyBase64: key.publicKeyBase64,
    });
    setMismatch(null);
    await connectHost(hostId);
  }, [mismatch, trustKnownHost, connectHost]);

  return {
    connectHost,
    connectingHostId,
    mismatch,
    trustAndReconnect,
    closeMismatch,
    noWorkspace,
  };
}
