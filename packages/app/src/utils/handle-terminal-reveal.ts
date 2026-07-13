import type { TerminalRevealMessage } from "@getpaseo/protocol/messages";
import { isSyntheticTerminalWorkspaceId } from "@/utils/terminal-workspace-id";

// Fork feature (SSH/terminal MCP): pure handler behind the terminal.reveal
// push. Every client registers SSH terminal metadata (remote label, no local
// file links); only the shouldFocus recipient navigates. Terminals placed in a
// synthetic workspace (ssh:<hostId> / standalone:<cwd>) have no navigable
// workspace — SSH ones are surfaced by the existing global SSH auto-open set.

export interface HandleTerminalRevealDeps {
  serverId: string;
  registerSshTerminal: (
    terminalId: string,
    meta: { hostId: string; label: string; serverId: string },
  ) => void;
  navigateToTerminalTab: (input: { workspaceId: string; terminalId: string }) => void;
}

export function handleTerminalReveal(
  payload: TerminalRevealMessage["payload"],
  deps: HandleTerminalRevealDeps,
): void {
  if (payload.sshHostId) {
    deps.registerSshTerminal(payload.terminalId, {
      hostId: payload.sshHostId,
      label: payload.sshHostLabel ?? payload.sshHostId,
      serverId: deps.serverId,
    });
  }

  if (!payload.shouldFocus) {
    return;
  }

  const workspaceId = payload.workspaceId;
  if (!workspaceId || isSyntheticTerminalWorkspaceId(workspaceId)) {
    return;
  }

  deps.navigateToTerminalTab({ workspaceId, terminalId: payload.terminalId });
}
