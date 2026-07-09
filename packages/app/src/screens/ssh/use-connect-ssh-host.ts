import { useCallback, useRef, useState } from "react";
import type { SshObservedHostKey } from "@getpaseo/protocol/messages";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSshKnownHosts } from "@/screens/ssh/use-ssh-known-hosts";
import { registerSshTerminal, useSshTerminalMetaStore } from "@/stores/ssh-terminal-meta-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useHostTerminals } from "@/hooks/use-host-terminals";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { isSyntheticTerminalWorkspaceId } from "@/utils/terminal-workspace-id";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
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

interface TargetWorkspace {
  workspaceId: string;
  // The workspace's local directory. Sent to the daemon so the SSH terminal
  // record is scoped to the workspace (and shows in its terminal list); the
  // remote shell never touches this path.
  directory: string | null;
}

// Resolves the workspace whose tab bar should host the SSH terminal: the
// last-active workspace on this server if any, else its first known workspace.
function resolveTargetWorkspace(serverId: string): TargetWorkspace | null {
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  const last = getLastWorkspaceSelection();
  let candidateId: string | null = null;
  if (last && last.serverId === serverId) {
    candidateId = last.workspaceId;
  } else if (workspaces && workspaces.size > 0) {
    candidateId = [...workspaces.keys()][0] ?? null;
  }
  if (!candidateId) {
    return null;
  }
  const mapKey = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId: candidateId });
  const descriptor = mapKey ? workspaces?.get(mapKey) : undefined;
  return {
    workspaceId: mapKey ?? candidateId,
    directory: descriptor?.workspaceDirectory ?? null,
  };
}

// Connects to an SSH host and opens its terminal as a tab in the active
// workspace's tab bar — reusing the workspace terminal panel + draggable tabs.
export function useConnectSshHost(serverId: string | null): UseConnectSshHostResult {
  const { hosts, connect } = useSshHosts(serverId);
  const { trustKnownHost } = useSshKnownHosts(serverId);
  const { terminals } = useHostTerminals(serverId);
  const metaByTerminalId = useSshTerminalMetaStore((state) => state.metaByTerminalId);
  const connectInFlightRef = useRef(false);
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ hostId: string; key: SshObservedHostKey } | null>(
    null,
  );
  const [noWorkspace, setNoWorkspace] = useState(false);

  // A live session already exists for this host: focus its terminal tab
  // instead of opening a second connection. Returns false when there is
  // nothing to focus (caller falls through to a fresh connect).
  const focusExistingHostTerminal = useCallback(
    (hostId: string): boolean => {
      if (!serverId) {
        return false;
      }
      const existing = terminals.find(
        (terminal) =>
          terminal.status !== "exited" && metaByTerminalId[terminal.id]?.hostId === hostId,
      );
      if (!existing) {
        return false;
      }
      const workspaceId =
        existing.workspaceId && !isSyntheticTerminalWorkspaceId(existing.workspaceId)
          ? existing.workspaceId
          : (resolveTargetWorkspace(serverId)?.workspaceId ?? null);
      if (!workspaceId) {
        return false;
      }
      navigateToPreparedWorkspaceTab({
        serverId,
        workspaceId,
        target: { kind: "terminal", terminalId: existing.id },
      });
      return true;
    },
    [metaByTerminalId, serverId, terminals],
  );

  const connectHost = useCallback(
    async (hostId: string, options?: { skipExisting?: boolean }) => {
      if (!serverId) {
        return;
      }
      // Tapping an already-connected host means "show me my session", not
      // "open another one". trustAndReconnect skips this (its point is a
      // fresh connect after trusting the new key).
      if (!options?.skipExisting && focusExistingHostTerminal(hostId)) {
        return;
      }
      // A double-click (or tapping another host mid-handshake) must not open a
      // second SSH session. State lands a tick later, so the same-tick guard
      // has to be a ref.
      if (connectInFlightRef.current) {
        return;
      }
      const workspace = resolveTargetWorkspace(serverId);
      if (!workspace) {
        setNoWorkspace(true);
        return;
      }
      const { workspaceId } = workspace;
      setNoWorkspace(false);
      const host = hosts.find((entry) => entry.id === hostId);
      connectInFlightRef.current = true;
      setConnectingHostId(hostId);
      try {
        // Pass the workspace placement so the daemon records the terminal as
        // belonging to this workspace (sidebar grouping, terminal list,
        // archive/history) instead of the synthetic ssh:<hostId> bucket.
        const payload = await connect({
          hostId,
          workspaceId,
          ...(workspace.directory ? { cwd: workspace.directory } : {}),
        });
        if (payload.terminal) {
          registerSshTerminal(payload.terminal.id, {
            hostId,
            label: host?.label || host?.address || payload.terminal.name,
          });
          // Same navigate-then-focus path as every other tab open, so the new
          // terminal's tab is focused and survives the layout-sync pull.
          navigateToPreparedWorkspaceTab({
            serverId,
            workspaceId,
            target: { kind: "terminal", terminalId: payload.terminal.id },
          });
        } else if (payload.code === "host_key_mismatch" && payload.observedKey) {
          setMismatch({ hostId, key: payload.observedKey });
        }
      } finally {
        connectInFlightRef.current = false;
        setConnectingHostId(null);
      }
    },
    [connect, focusExistingHostTerminal, hosts, serverId],
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
    await connectHost(hostId, { skipExisting: true });
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
