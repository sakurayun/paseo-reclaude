import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import {
  unregisterSshTerminal,
  type SshTerminalMeta,
  useSshTerminalMetaStore,
} from "@/stores/ssh-terminal-meta-store";
import { undismissSshTab, undismissSshTabEverywhere } from "@/stores/ssh-tab-dismissed-store";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

/**
 * Live SSH terminal ids that should appear in every workspace tab bar on a
 * given server.
 *
 * Authority is the host-wide terminal list: only meta-registered shells that
 * still exist and are not exited are auto-opened. Meta alone must not invent
 * tabs after a kill — otherwise restart resurrects permanently closed shells.
 */
export function collectLiveSshTerminalIds(input: {
  serverId: string;
  metaByTerminalId: Record<string, SshTerminalMeta>;
  hostWideTerminals: ReadonlyArray<{ id: string; status?: string | null }>;
}): string[] {
  const ids: string[] = [];
  for (const terminal of input.hostWideTerminals) {
    if (terminal.status === "exited") {
      continue;
    }
    const meta = input.metaByTerminalId[terminal.id];
    if (!meta) {
      continue;
    }
    // Older meta entries lack serverId — treat them as matching every server.
    if (meta.serverId && meta.serverId !== input.serverId) {
      continue;
    }
    ids.push(terminal.id);
  }
  return ids;
}

/**
 * Drop persisted SSH meta only for shells the host explicitly reports as
 * exited. Missing ids are left alone — an empty/partial host-wide list on
 * reconnect must not wipe meta (that would also drop cached OS badges for
 * still-running tabs until the next connect).
 */
export function pruneStaleSshTerminalMeta(input: {
  serverId: string;
  metaByTerminalId: Record<string, SshTerminalMeta>;
  hostWideTerminals: ReadonlyArray<{ id: string; status?: string | null }>;
}): void {
  if (input.hostWideTerminals.length === 0) {
    return;
  }
  const statusById = new Map(
    input.hostWideTerminals.map((terminal) => [terminal.id, terminal.status ?? "running"]),
  );
  for (const [terminalId, meta] of Object.entries(input.metaByTerminalId)) {
    if (meta.serverId && meta.serverId !== input.serverId) {
      continue;
    }
    if (statusById.get(terminalId) === "exited") {
      unregisterSshTerminal(terminalId);
    }
  }
}

/**
 * Ensure an SSH terminal tab exists in every known workspace on the server.
 * Focuses the tab in `focusWorkspaceId` (when provided); other workspaces
 * get a background open so the user's current view does not jump.
 */
export function openSshTerminalAcrossServerWorkspaces(input: {
  serverId: string;
  terminalId: string;
  focusWorkspaceId?: string | null;
}): void {
  const workspaces = useSessionStore.getState().sessions[input.serverId]?.workspaces;
  if (!workspaces || workspaces.size === 0) {
    return;
  }

  // Explicit open (connect / focus-from-list) clears dismiss so the tab may
  // surface again in every workspace's auto-open set.
  undismissSshTabEverywhere(input.terminalId);

  const layoutStore = useWorkspaceLayoutStore.getState();
  const target = { kind: "terminal" as const, terminalId: input.terminalId };
  const focusId = input.focusWorkspaceId?.trim() || null;

  for (const workspaceId of workspaces.keys()) {
    const key = buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId,
    });
    if (!key) {
      continue;
    }
    undismissSshTab(key, input.terminalId);
    if (focusId && workspaceId === focusId) {
      layoutStore.openTabFocused(key, target);
    } else {
      layoutStore.openTabInBackground(key, target);
    }
  }
}

/**
 * Permanently remove an SSH shell from every workspace tab bar and drop its
 * persisted meta. Call after the user kills the terminal (or it is gone).
 */
export function closeSshTerminalAcrossServerWorkspaces(input: {
  serverId: string;
  terminalId: string;
}): void {
  undismissSshTabEverywhere(input.terminalId);
  unregisterSshTerminal(input.terminalId);

  const workspaces = useSessionStore.getState().sessions[input.serverId]?.workspaces;
  if (!workspaces || workspaces.size === 0) {
    // Still clear any layout keys that might hold the tab if workspaces are empty.
    closeTerminalTabsInAllLayouts(input.terminalId);
    return;
  }

  const layoutStore = useWorkspaceLayoutStore.getState();
  const tabId = buildDeterministicWorkspaceTabId({
    kind: "terminal",
    terminalId: input.terminalId,
  });

  for (const workspaceId of workspaces.keys()) {
    const key = buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId,
    });
    if (!key) {
      continue;
    }
    layoutStore.closeTab(key, tabId);
  }
}

function closeTerminalTabsInAllLayouts(terminalId: string): void {
  const layoutStore = useWorkspaceLayoutStore.getState();
  const tabId = buildDeterministicWorkspaceTabId({ kind: "terminal", terminalId });
  for (const workspaceKey of Object.keys(layoutStore.layoutByWorkspace)) {
    layoutStore.closeTab(workspaceKey, tabId);
  }
}

/** True when this terminal id is registered as an SSH remote shell. */
export function isSshTerminalId(terminalId: string): boolean {
  return Boolean(useSshTerminalMetaStore.getState().metaByTerminalId[terminalId]);
}
