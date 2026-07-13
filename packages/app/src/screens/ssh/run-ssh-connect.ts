import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SshHostsConnectResponse } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { generateMessageId } from "@/types/stream";
import { confirmDialog } from "@/utils/confirm-dialog";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { registerSshTerminal } from "@/stores/ssh-terminal-meta-store";
import { useSessionStore } from "@/stores/session-store";
import { queryClient } from "@/data/query-client";
import { getLastMeasuredTerminalSize } from "@/terminal/runtime/last-terminal-size";
import {
  buildTerminalsQueryKey,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { upsertTerminalListEntry } from "@/utils/terminal-list";

type ConnectedTerminal = NonNullable<SshHostsConnectResponse["payload"]["terminal"]>;
import {
  findInFlightConnectIdByHost,
  useSshConnectStore,
  type SshConnectState,
} from "@/stores/ssh-connect-store";

export interface StartSshConnectInput {
  serverId: string;
  hostId: string;
  workspaceId: string;
  cwd: string | null;
  label: string;
  os: string | null;
  // Always start a fresh attempt even if this host already has one in flight
  // (right-click "new tab & connect").
  force?: boolean;
}

// Live progress subscriptions, kept until the attempt succeeds or is cancelled
// so an inline password/mismatch retry keeps streaming into the same tab.
const progressUnsubById = new Map<string, () => void>();

function getClient(serverId: string): DaemonClient | null {
  return useSessionStore.getState().sessions[serverId]?.client ?? null;
}

function connectingTabId(connectId: string): string {
  return buildDeterministicWorkspaceTabId({ kind: "ssh-connecting", connectId });
}

function focusConnectingTab(state: SshConnectState): void {
  navigateToPreparedWorkspaceTab({
    serverId: state.serverId,
    workspaceId: state.workspaceId,
    target: { kind: "ssh-connecting", connectId: state.connectId },
  });
}

// Opens a connecting tab for a host and drives the SSH connect through to a
// terminal tab, surfacing progress / password / mismatch / error inline.
export function startSshConnect(input: StartSshConnectInput): void {
  const store = useSshConnectStore.getState();

  if (!input.force) {
    const existingId = findInFlightConnectIdByHost(input.serverId, input.hostId);
    const existing = existingId ? store.byId[existingId] : null;
    if (existing) {
      focusConnectingTab(existing);
      return;
    }
  }

  const client = getClient(input.serverId);
  if (!client) {
    return;
  }

  const connectId = `sshc_${generateMessageId()}`;
  const state: SshConnectState = {
    connectId,
    serverId: input.serverId,
    hostId: input.hostId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    label: input.label,
    os: input.os,
    status: "connecting",
    error: null,
    observedKey: null,
    usedPasswordOverride: false,
    log: [],
  };
  store.start(state);

  const unsubscribe = client.on("ssh.hosts.connect.progress", (message) => {
    if (message.payload.connectId !== connectId) {
      return;
    }
    useSshConnectStore
      .getState()
      .appendLog(connectId, { line: message.payload.line, level: message.payload.level });
  });
  progressUnsubById.set(connectId, unsubscribe);

  focusConnectingTab(state);
  void runAttempt(connectId);
}

async function runAttempt(connectId: string, password?: string): Promise<void> {
  const store = useSshConnectStore.getState();
  const state = store.byId[connectId];
  if (!state) {
    return;
  }
  const client = getClient(state.serverId);
  if (!client) {
    store.patch(connectId, {
      status: "error",
      error: i18n.t("workspace.terminal.hostDisconnected"),
    });
    return;
  }

  store.patch(connectId, {
    status: "connecting",
    error: null,
    observedKey: null,
    usedPasswordOverride: password !== undefined,
  });

  try {
    // Open the remote pty (and the daemon's headless mirror) at the size the
    // terminal pane will render, so the login banner lays out correctly from
    // the first byte — resizing after the fact leaves the remote's absolutely
    // positioned output (and cursor) stranded mid-history.
    const initialSize = getLastMeasuredTerminalSize();
    const payload = await client.connectSshHost({
      hostId: state.hostId,
      workspaceId: state.workspaceId,
      connectId,
      ...(state.cwd ? { cwd: state.cwd } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(initialSize ? { cols: initialSize.cols, rows: initialSize.rows } : {}),
    });

    if (payload.terminal) {
      await finishConnected(connectId, payload.terminal, password);
      return;
    }
    if (payload.code === "host_key_mismatch" && payload.observedKey) {
      store.patch(connectId, {
        status: "mismatch",
        error: payload.error ?? null,
        observedKey: payload.observedKey,
      });
      return;
    }
    if (payload.code === "auth_failed") {
      store.patch(connectId, { status: "auth_failed", error: payload.error ?? null });
      return;
    }
    store.patch(connectId, {
      status: "error",
      error: payload.error ?? i18n.t("ssh.connect.genericError"),
    });
  } catch (error) {
    store.patch(connectId, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function finishConnected(
  connectId: string,
  terminal: ConnectedTerminal,
  password: string | undefined,
): Promise<void> {
  const store = useSshConnectStore.getState();
  const state = store.byId[connectId];
  if (!state) {
    return;
  }
  const client = getClient(state.serverId);
  const terminalId = terminal.id;

  registerSshTerminal(terminalId, { hostId: state.hostId, label: state.label });

  // Optimistically seed the host-wide terminal list so the workspace's tab
  // reconcile sees this terminal immediately. Otherwise the retarget below
  // races the terminals_changed push and the new tab is pruned as "unknown" —
  // most visibly on an instant pooled reconnect (the tab flashes then vanishes).
  const hostWideKey = buildTerminalsQueryKey(state.serverId, "", null);
  queryClient.setQueryData<ListTerminalsPayload>(hostWideKey, (current) => ({
    ...current,
    terminals: upsertTerminalListEntry({
      terminals: current?.terminals ?? [],
      terminal,
    }),
    requestId: current?.requestId ?? `ssh-connect-${terminalId}`,
  }));

  // An override password that just succeeded is a candidate to persist — but
  // only after the user confirms.
  if (password !== undefined && client) {
    const shouldSave = await confirmDialog({
      title: i18n.t("ssh.connect.savePasswordTitle"),
      message: i18n.t("ssh.connect.savePasswordMessage", { host: state.label }),
      confirmLabel: i18n.t("ssh.connect.savePasswordConfirm"),
      cancelLabel: i18n.t("workspace.tabs.confirmations.cancel"),
    });
    if (shouldSave) {
      try {
        await client.updateSshHost({ id: state.hostId, host: {}, password });
      } catch {
        // Non-fatal: the terminal is already connected.
      }
    }
  }

  // Retarget the connecting tab in place into a real terminal tab.
  const key = buildWorkspaceTabPersistenceKey({
    serverId: state.serverId,
    workspaceId: state.workspaceId,
  });
  if (key) {
    useWorkspaceLayoutStore
      .getState()
      .retargetTab(key, connectingTabId(connectId), { kind: "terminal", terminalId });
  }

  disposeConnect(connectId);
}

// Inline retry with a new password after an auth failure.
export function retrySshConnect(connectId: string, password: string): void {
  useSshConnectStore
    .getState()
    .appendLog(connectId, { line: i18n.t("ssh.connect.retryingLog"), level: "info" });
  void runAttempt(connectId, password);
}

// Retry a failed attempt without a new password (transient/generic error).
export function reconnectSshConnect(connectId: string): void {
  useSshConnectStore
    .getState()
    .appendLog(connectId, { line: i18n.t("ssh.connect.retryingLog"), level: "info" });
  void runAttempt(connectId);
}

// Trust the newly observed host key, then reconnect (mismatch path).
export function trustAndReconnectConnect(connectId: string): void {
  const state = useSshConnectStore.getState().byId[connectId];
  if (!state?.observedKey) {
    return;
  }
  const client = getClient(state.serverId);
  if (!client) {
    return;
  }
  const key = state.observedKey;
  useSshConnectStore
    .getState()
    .appendLog(connectId, { line: i18n.t("ssh.connect.trustingLog"), level: "info" });
  useSshConnectStore.getState().patch(connectId, { status: "connecting" });
  void client
    .trustSshKnownHost({
      host: key.host,
      ...(key.port !== undefined ? { port: key.port } : {}),
      keyType: key.keyType,
      publicKeyBase64: key.publicKeyBase64,
    })
    .then(() => runAttempt(connectId))
    .catch((error: unknown) => {
      useSshConnectStore.getState().patch(connectId, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

// Close the connecting tab and drop its state (user gave up or reload).
export function cancelSshConnect(connectId: string): void {
  const state = useSshConnectStore.getState().byId[connectId];
  if (state) {
    const key = buildWorkspaceTabPersistenceKey({
      serverId: state.serverId,
      workspaceId: state.workspaceId,
    });
    if (key) {
      useWorkspaceLayoutStore.getState().closeTab(key, connectingTabId(connectId));
    }
  }
  disposeConnect(connectId);
}

function disposeConnect(connectId: string): void {
  progressUnsubById.get(connectId)?.();
  progressUnsubById.delete(connectId);
  useSshConnectStore.getState().remove(connectId);
}
