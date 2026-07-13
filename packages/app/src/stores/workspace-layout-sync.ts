import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { supportsDesktopPaneSplits } from "@/constants/layout";
import {
  collectAllTabs,
  normalizeLayout,
  removeTransientTabsFromLayout,
  stripWorkspaceLayoutFocus,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTab } from "@/stores/workspace-tabs-store";

// Single, off-React integration point for desktop workspace-layout sync. One bridge
// per serverId mirrors the local workspace-layout-store to the daemon and applies
// remote layouts from peers. All anti-loop / pull-before-push / revision logic lives
// here so the feature has no defensive branches scattered through the store or screens.
//
// COMPAT(workspaceLayoutSync): gated on server_info.features.workspaceLayoutSync.

const PUSH_DEBOUNCE_MS = 300;

type LayoutStoreState = ReturnType<typeof useWorkspaceLayoutStore.getState>;

interface LayoutSyncBridge {
  serverId: string;
  client: DaemonClient;
  // Highest revision we've observed (sent or received) per workspaceKey.
  revisionByKey: Map<string, number>;
  // Keys currently being written from a remote layout — their store change must not
  // be echoed back to the daemon.
  applyingRemoteKeys: Set<string>;
  // Keys whose remote snapshot has been pulled. A workspace cannot push before it has
  // pulled (so a fresh client's startup prune never clobbers a peer's layout).
  pulledKeys: Set<string>;
  pullingKeys: Set<string>;
  // Tabs opened locally while the key was still un-pulled (e.g. an SSH connect
  // opens a terminal tab right before first navigation into the workspace).
  // The pull's structure-wins merge would silently wipe them, so they're
  // re-opened on top of the pulled layout once the key syncs.
  pendingLocalOpensByKey: Map<string, WorkspaceTab[]>;
  // JSON of the last pushed (focus-stripped) blob, so a pure focus change is a no-op.
  lastPushedStrippedByKey: Map<string, string>;
  pushTimers: Map<string, ReturnType<typeof setTimeout>>;
  unsubscribeStore: (() => void) | null;
  unsubscribeChanged: (() => void) | null;
  stopped: boolean;
}

const bridgesByServerId = new Map<string, LayoutSyncBridge>();

function isFeatureEnabled(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.workspaceLayoutSync ===
    true
  );
}

// workspaceKey is `${serverId}:${workspaceId}`; workspaceId is opaque and may contain
// ":", so only strip the known serverId prefix rather than splitting.
function extractWorkspaceId(key: string, serverId: string): string | null {
  const prefix = `${serverId}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function applyRemote(bridge: LayoutSyncBridge, key: string, layout: unknown): void {
  bridge.applyingRemoteKeys.add(key);
  try {
    useWorkspaceLayoutStore.getState().applyRemoteLayout(key, layout);
  } finally {
    // Release after the store's subscribe listeners have run, so the synchronous
    // change from applyRemoteLayout is recognized as remote and not pushed back.
    queueMicrotask(() => bridge.applyingRemoteKeys.delete(key));
  }
}

const MAX_PENDING_LOCAL_OPENS = 8;

// Record entity tabs added locally while the key is still un-pulled. Hydration
// writes are excluded — only post-hydration changes are genuine user opens.
function recordPendingLocalOpens(
  bridge: LayoutSyncBridge,
  key: string,
  next: LayoutStoreState,
  prev: LayoutStoreState,
): void {
  if (bridge.pulledKeys.has(key) || bridge.applyingRemoteKeys.has(key)) {
    return;
  }
  if (!useWorkspaceLayoutStore.persist.hasHydrated()) {
    return;
  }
  const nextLayout = next.layoutByWorkspace[key];
  if (!nextLayout) {
    return;
  }
  const prevLayout = prev.layoutByWorkspace[key];
  const previousTabIds = new Set(
    prevLayout ? collectAllTabs(prevLayout.root).map((tab) => tab.tabId) : [],
  );
  const addedTabs = collectAllTabs(nextLayout.root).filter(
    // Transient ssh-connecting tabs are device-local and short-lived; never
    // re-open them after a pull.
    (tab) => !previousTabIds.has(tab.tabId) && tab.target.kind !== "ssh-connecting",
  );
  if (addedTabs.length === 0) {
    return;
  }
  const pending = bridge.pendingLocalOpensByKey.get(key) ?? [];
  for (const tab of addedTabs) {
    if (!pending.some((entry) => entry.tabId === tab.tabId)) {
      pending.push(tab);
    }
  }
  bridge.pendingLocalOpensByKey.set(key, pending.slice(-MAX_PENDING_LOCAL_OPENS));
}

// Re-open recorded local tabs on top of the freshly synced layout. Runs in a
// microtask so it lands after applyRemote's anti-echo release — the re-open is
// then a normal local change and pushes to peers.
function scheduleReopenPendingLocalOpens(bridge: LayoutSyncBridge, key: string): void {
  const pending = bridge.pendingLocalOpensByKey.get(key);
  bridge.pendingLocalOpensByKey.delete(key);
  if (!pending || pending.length === 0) {
    return;
  }
  queueMicrotask(() => {
    if (bridge.stopped) {
      return;
    }
    const store = useWorkspaceLayoutStore.getState();
    const existingTabIds = new Set(store.getWorkspaceTabs(key).map((tab) => tab.tabId));
    for (const tab of pending) {
      if (!existingTabIds.has(tab.tabId)) {
        store.openTabFocused(key, tab.target);
      }
    }
  });
}

async function pushLayout(
  bridge: LayoutSyncBridge,
  key: string,
  workspaceId: string,
  stripped: WorkspaceLayout,
  strippedJson: string,
): Promise<void> {
  if (bridge.stopped) {
    return;
  }
  const revision = (bridge.revisionByKey.get(key) ?? 0) + 1;
  bridge.revisionByKey.set(key, revision);
  bridge.lastPushedStrippedByKey.set(key, strippedJson);
  try {
    const result = await bridge.client.pushWorkspaceLayout({
      workspaceId,
      revision,
      layout: stripped as unknown as Record<string, unknown>,
    });
    if (!result.accepted) {
      // A peer wrote a newer revision. Align ours; its changed broadcast (already in
      // flight) overwrites our local layout.
      bridge.revisionByKey.set(key, result.revision);
    }
  } catch {
    // Transient push failure; the next local change retries.
  }
}

function maybePush(
  bridge: LayoutSyncBridge,
  key: string,
  next: LayoutStoreState,
  prev: LayoutStoreState,
): void {
  const workspaceId = extractWorkspaceId(key, bridge.serverId);
  if (!workspaceId) {
    return;
  }
  if (bridge.applyingRemoteKeys.has(key)) {
    return; // remote-applied change — do not echo
  }
  if (!bridge.pulledKeys.has(key)) {
    return; // pull-before-push: haven't synced this workspace yet
  }
  // The fork's startup prune (keep only running-session tabs) runs once per launch.
  // Never push that prune pass — it would clobber a peer's intentionally-kept idle tabs.
  if (
    next.initialRestoreDoneByWorkspace[key] === true &&
    prev.initialRestoreDoneByWorkspace[key] !== true
  ) {
    return;
  }
  // Transient ssh-connecting tabs are device-local; never push them to peers.
  const stripped = stripWorkspaceLayoutFocus(
    removeTransientTabsFromLayout(normalizeLayout(next.layoutByWorkspace[key])),
  );
  const strippedJson = JSON.stringify(stripped);
  if (strippedJson === bridge.lastPushedStrippedByKey.get(key)) {
    return; // pure focus (or otherwise no-op) change
  }

  const existing = bridge.pushTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  bridge.pushTimers.set(
    key,
    setTimeout(() => {
      bridge.pushTimers.delete(key);
      void pushLayout(bridge, key, workspaceId, stripped, strippedJson);
    }, PUSH_DEBOUNCE_MS),
  );
}

async function ensurePulled(bridge: LayoutSyncBridge, workspaceId: string): Promise<void> {
  if (bridge.stopped || !supportsDesktopPaneSplits() || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  const key = buildWorkspaceTabPersistenceKey({ serverId: bridge.serverId, workspaceId });
  if (!key || bridge.pulledKeys.has(key) || bridge.pullingKeys.has(key)) {
    return;
  }
  bridge.pullingKeys.add(key);
  try {
    const envelope = await bridge.client.getWorkspaceLayout(workspaceId);
    if (!bridge.stopped && envelope && envelope.revision > (bridge.revisionByKey.get(key) ?? -1)) {
      bridge.revisionByKey.set(key, envelope.revision);
      applyRemote(bridge, key, envelope.layout);
    }
  } catch {
    // Pull failed; still unlock pushes below so the workspace isn't stuck read-only.
  } finally {
    bridge.pullingKeys.delete(key);
    bridge.pulledKeys.add(key);
    scheduleReopenPendingLocalOpens(bridge, key);
  }
}

function stopBridge(bridge: LayoutSyncBridge): void {
  if (bridge.stopped) {
    return;
  }
  bridge.stopped = true;
  bridge.unsubscribeStore?.();
  bridge.unsubscribeChanged?.();
  for (const timer of bridge.pushTimers.values()) {
    clearTimeout(timer);
  }
  bridge.pushTimers.clear();
  if (bridgesByServerId.get(bridge.serverId) === bridge) {
    bridgesByServerId.delete(bridge.serverId);
  }
}

// Start syncing this serverId's desktop layouts. Returns a stop function for the
// session effect's cleanup. Safe to call when the feature is unsupported/disabled:
// the subscriptions stay installed but every path no-ops until it becomes enabled.
export function startWorkspaceLayoutSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;
  const existing = bridgesByServerId.get(serverId);
  if (existing) {
    stopBridge(existing);
  }

  const bridge: LayoutSyncBridge = {
    serverId,
    client,
    revisionByKey: new Map(),
    applyingRemoteKeys: new Set(),
    pulledKeys: new Set(),
    pullingKeys: new Set(),
    pendingLocalOpensByKey: new Map(),
    lastPushedStrippedByKey: new Map(),
    pushTimers: new Map(),
    unsubscribeStore: null,
    unsubscribeChanged: null,
    stopped: false,
  };
  bridgesByServerId.set(serverId, bridge);

  bridge.unsubscribeStore = useWorkspaceLayoutStore.subscribe((next, prev) => {
    if (bridge.stopped || !supportsDesktopPaneSplits() || !isFeatureEnabled(serverId)) {
      return;
    }
    if (next.layoutByWorkspace === prev.layoutByWorkspace) {
      return; // fast path: layouts object unchanged
    }
    for (const key in next.layoutByWorkspace) {
      if (next.layoutByWorkspace[key] !== prev.layoutByWorkspace[key]) {
        recordPendingLocalOpens(bridge, key, next, prev);
        maybePush(bridge, key, next, prev);
      }
    }
  });

  bridge.unsubscribeChanged = client.on("workspace.layout.changed", (msg) => {
    if (msg.type !== "workspace.layout.changed") {
      return;
    }
    if (bridge.stopped || !supportsDesktopPaneSplits() || !isFeatureEnabled(serverId)) {
      return;
    }
    const { workspaceId, revision, layout } = msg.payload;
    const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    if (!key || revision <= (bridge.revisionByKey.get(key) ?? -1)) {
      return; // stale or our own echo
    }
    bridge.revisionByKey.set(key, revision);
    applyRemote(bridge, key, layout);
    bridge.pulledKeys.add(key); // receiving a change means we're synced; allow pushes
    scheduleReopenPendingLocalOpens(bridge, key);
  });

  return () => stopBridge(bridge);
}

// Called when the user opens/switches to a workspace on a desktop client. Pulls the
// daemon's current layout (overriding the local one) before this workspace is allowed
// to push, so a fresh client's startup prune never propagates to peers.
export function pullWorkspaceLayoutIfNeeded(serverId: string, workspaceId: string): void {
  const bridge = bridgesByServerId.get(serverId);
  if (bridge) {
    void ensurePulled(bridge, workspaceId);
  }
}
