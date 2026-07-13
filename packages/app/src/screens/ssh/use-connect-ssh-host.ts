import { useCallback, useState } from "react";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSshTerminalMetaStore } from "@/stores/ssh-terminal-meta-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useHostTerminals } from "@/hooks/use-host-terminals";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { isSyntheticTerminalWorkspaceId } from "@/utils/terminal-workspace-id";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { startSshConnect } from "@/screens/ssh/run-ssh-connect";

export interface UseConnectSshHostResult {
  // Opens a connecting tab and drives the SSH connect (progress log + inline
  // password/mismatch retry all live in that tab). `force` starts a fresh
  // attempt even if the host already has a live session/connect.
  connectHost: (hostId: string, options?: { force?: boolean }) => void;
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

// Connects to an SSH host by opening a connecting tab in the active workspace's
// tab bar; on success that tab becomes the terminal tab.
export function useConnectSshHost(serverId: string | null): UseConnectSshHostResult {
  const { hosts } = useSshHosts(serverId);
  const { terminals } = useHostTerminals(serverId);
  const metaByTerminalId = useSshTerminalMetaStore((state) => state.metaByTerminalId);
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
    (hostId: string, options?: { force?: boolean }) => {
      if (!serverId) {
        return;
      }
      // Tapping an already-connected host means "show me my session", not
      // "open another one" — unless the caller explicitly forces a new tab.
      if (!options?.force && focusExistingHostTerminal(hostId)) {
        return;
      }
      const workspace = resolveTargetWorkspace(serverId);
      if (!workspace) {
        setNoWorkspace(true);
        return;
      }
      setNoWorkspace(false);
      const host = hosts.find((entry) => entry.id === hostId);
      startSshConnect({
        serverId,
        hostId,
        workspaceId: workspace.workspaceId,
        cwd: workspace.directory,
        label: host?.label || host?.address || hostId,
        os: host?.platform?.os ?? null,
        ...(options?.force ? { force: true } : {}),
      });
    },
    [focusExistingHostTerminal, hosts, serverId],
  );

  return { connectHost, noWorkspace };
}
