import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { isWeb } from "@/constants/platform";
import { useDraftConflictStore } from "@/stores/draft-conflict-store";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady, type DraftRecord } from "@/stores/draft-store/state";
import { useSessionStore } from "@/stores/session-store";

// Composer draft text syncs across every client connected to the same daemon —
// mobile included. An unsent message typed in one session's composer appears in
// that same session on the other clients. Mirrors appearance-settings-sync
// (opaque blob + revision LWW + pull-before-push) with three draft-specific
// differences:
//   1. The synced store is the Zustand `useDraftStore`, not a React Query cache,
//      so the bridge subscribes to the store directly.
//   2. Only the `text` of `lifecycle === "active"` drafts is synced — attachments
//      reference per-device local files and would dangle on a peer, so they stay
//      device-local.
//   3. apply does a per-draft three-way merge (base = lastSynced) so a draft the
//      user is actively editing is never clobbered by a remote update; only
//      drafts with no un-pushed local change adopt the remote text.
const PUSH_DEBOUNCE_MS = 600;

// Drafts are keyed `"{prefix}:{serverId}:{rest}"` (see stores/draft-keys.ts), so a
// per-server bridge only syncs the drafts whose key carries its serverId.
function draftKeyServerId(draftKey: string): string | null {
  const parts = draftKey.split(":");
  return parts.length >= 2 ? parts[1] : null;
}

interface ComposerDraftsSyncBridge {
  serverId: string;
  client: DaemonClient;
  revision: number;
  applyingRemote: boolean;
  pulled: boolean;
  // draftKey → synced text. Doubles as the dedupe baseline and the three-way
  // merge base. A key whose local text differs from this is "being edited".
  lastSynced: Map<string, string>;
  pushTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeStore: (() => void) | null;
  unsubscribeChanged: (() => void) | null;
  unsubscribeSession: (() => void) | null;
  stopped: boolean;
}

const bridgesByServerId = new Map<string, ComposerDraftsSyncBridge>();

function isFeatureEnabled(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.composerDraftsSync === true
  );
}

/** Active drafts for this server as `draftKey → text` (non-empty text only). */
function extractSyncedDrafts(serverId: string): Map<string, string> {
  const result = new Map<string, string>();
  const { drafts } = useDraftStore.getState();
  for (const [draftKey, record] of Object.entries(drafts)) {
    if (draftKeyServerId(draftKey) !== serverId) {
      continue;
    }
    const input = toDraftInputIfReady(record);
    if (!input || input.text.length === 0) {
      continue;
    }
    result.set(draftKey, input.text);
  }
  return result;
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

/** Validates the opaque remote blob into `draftKey → text` for this server. */
function parseRemoteDrafts(raw: Record<string, unknown>, serverId: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [draftKey, value] of Object.entries(raw)) {
    if (typeof value !== "string" || draftKeyServerId(draftKey) !== serverId) {
      continue;
    }
    result.set(draftKey, value);
  }
  return result;
}

/**
 * Per-draft three-way merge of the remote snapshot into the local draft store.
 * For each draftKey, base = `bridge.lastSynced`, local = current store text,
 * remote = incoming text:
 *   - local === base (no un-pushed edit) → adopt remote (set or delete).
 *   - local !== base (user is editing)   → keep local; lastSynced stays at base
 *     so the next debounce pushes the in-progress edit out.
 */
function applyRemote(
  bridge: ComposerDraftsSyncBridge,
  revision: number,
  raw: Record<string, unknown>,
): void {
  bridge.revision = revision;
  const remote = parseRemoteDrafts(raw, bridge.serverId);
  const local = extractSyncedDrafts(bridge.serverId);
  const nextLastSynced = new Map(bridge.lastSynced);
  const adopt = new Map<string, string | null>(); // draftKey → text, or null = delete

  const keys = new Set<string>([...local.keys(), ...remote.keys(), ...bridge.lastSynced.keys()]);
  for (const key of keys) {
    if (draftKeyServerId(key) !== bridge.serverId) {
      continue;
    }
    const base = bridge.lastSynced.get(key);
    const localText = local.get(key);
    const remoteText = remote.get(key);
    const localEditing = localText !== base;
    if (localEditing) {
      // Don't clobber the in-progress edit. Surface the diverging remote text as a
      // conflict (the composer offers it in a drawer) instead of discarding it;
      // leave lastSynced at base so the next debounce re-pushes the local edit.
      const conflictStore = useDraftConflictStore.getState();
      if (remoteText !== undefined && remoteText !== localText) {
        conflictStore.setConflict(key, remoteText);
      } else {
        conflictStore.clearConflict(key);
      }
      continue;
    }
    // No un-pushed local edit → any earlier conflict on this key is resolved.
    useDraftConflictStore.getState().clearConflict(key);
    if (remoteText === undefined) {
      // Remote dropped it and local has no edit → clear locally.
      if (localText !== undefined) {
        adopt.set(key, null);
      }
      nextLastSynced.delete(key);
    } else {
      if (remoteText !== localText) {
        adopt.set(key, remoteText);
      }
      nextLastSynced.set(key, remoteText);
    }
  }

  bridge.lastSynced = nextLastSynced;
  if (adopt.size === 0) {
    return;
  }

  bridge.applyingRemote = true;
  const applyTime = Date.now();
  useDraftStore.setState((state) => {
    const drafts = { ...state.drafts };
    for (const [key, text] of adopt) {
      const existing = drafts[key];
      if (text === null) {
        // Match clearDraftInput(abandoned): keep the record but blank it.
        if (existing) {
          drafts[key] = {
            ...existing,
            input: { text: "", attachments: existing.input.attachments },
            lifecycle: "abandoned",
            updatedAt: applyTime,
            version: existing.version + 1,
          };
        }
        continue;
      }
      const record: DraftRecord = {
        input: { text, attachments: existing?.input.attachments ?? [] },
        lifecycle: "active",
        updatedAt: applyTime,
        version: (existing?.version ?? 0) + 1,
      };
      drafts[key] = record;
    }
    return { ...state, drafts };
  });
  bridge.applyingRemote = false;
}

async function pushDrafts(
  bridge: ComposerDraftsSyncBridge,
  drafts: Map<string, string>,
): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  if (mapsEqual(drafts, bridge.lastSynced)) {
    return;
  }
  const revision = bridge.revision + 1;
  bridge.revision = revision;
  bridge.lastSynced = new Map(drafts);
  try {
    const result = await bridge.client.pushComposerDrafts({
      revision,
      drafts: Object.fromEntries(drafts),
    });
    if (!result.accepted) {
      // A peer won the race; adopt the daemon's authoritative envelope.
      bridge.revision = result.revision;
      const envelope = await bridge.client.getComposerDrafts();
      if (!bridge.stopped && envelope.revision >= bridge.revision) {
        applyRemote(bridge, envelope.revision, envelope.drafts);
      }
    }
  } catch {
    // Transient sync failure; the next local edit retries.
  }
}

function schedulePush(bridge: ComposerDraftsSyncBridge, drafts: Map<string, string>): void {
  if (bridge.pushTimer) {
    clearTimeout(bridge.pushTimer);
  }
  bridge.pushTimer = setTimeout(() => {
    bridge.pushTimer = null;
    void pushDrafts(bridge, drafts);
  }, PUSH_DEBOUNCE_MS);
}

function onStoreChange(bridge: ComposerDraftsSyncBridge): void {
  if (
    bridge.stopped ||
    bridge.applyingRemote ||
    !bridge.pulled ||
    !isFeatureEnabled(bridge.serverId)
  ) {
    return;
  }
  const drafts = extractSyncedDrafts(bridge.serverId);
  if (mapsEqual(drafts, bridge.lastSynced)) {
    return;
  }
  schedulePush(bridge, drafts);
}

async function initialPull(bridge: ComposerDraftsSyncBridge): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  try {
    const local = extractSyncedDrafts(bridge.serverId);
    const envelope = await bridge.client.getComposerDrafts();
    if (bridge.stopped) {
      return;
    }
    bridge.pulled = true;
    if (envelope.revision === 0) {
      // Empty daemon store: seed from desktop/web only so a freshly connected
      // mobile adopts the desktop's drafts instead of imposing its own.
      if (isWeb && local.size > 0) {
        bridge.revision = 0;
        await pushDrafts(bridge, local);
      }
      return;
    }
    applyRemote(bridge, envelope.revision, envelope.drafts);
  } catch {
    bridge.pulled = true;
  }
}

function stopBridge(bridge: ComposerDraftsSyncBridge): void {
  if (bridge.stopped) {
    return;
  }
  bridge.stopped = true;
  bridge.unsubscribeStore?.();
  bridge.unsubscribeChanged?.();
  bridge.unsubscribeSession?.();
  if (bridge.pushTimer) {
    clearTimeout(bridge.pushTimer);
    bridge.pushTimer = null;
  }
  if (bridgesByServerId.get(bridge.serverId) === bridge) {
    bridgesByServerId.delete(bridge.serverId);
  }
}

export function startComposerDraftsSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;
  const existing = bridgesByServerId.get(serverId);
  if (existing) {
    stopBridge(existing);
  }

  const bridge: ComposerDraftsSyncBridge = {
    serverId,
    client,
    revision: 0,
    applyingRemote: false,
    pulled: false,
    lastSynced: new Map(),
    pushTimer: null,
    unsubscribeStore: null,
    unsubscribeChanged: null,
    unsubscribeSession: null,
    stopped: false,
  };
  bridgesByServerId.set(serverId, bridge);

  bridge.unsubscribeStore = useDraftStore.subscribe(() => onStoreChange(bridge));

  bridge.unsubscribeChanged = client.on("composer.drafts.changed", (msg) => {
    if (msg.type !== "composer.drafts.changed") {
      return;
    }
    if (bridge.stopped || !isFeatureEnabled(serverId)) {
      return;
    }
    if (msg.payload.revision <= bridge.revision) {
      return;
    }
    bridge.pulled = true;
    applyRemote(bridge, msg.payload.revision, msg.payload.drafts);
  });

  bridge.unsubscribeSession = useSessionStore.subscribe((next, prev) => {
    const nextEnabled = next.sessions[serverId]?.serverInfo?.features?.composerDraftsSync === true;
    const prevEnabled = prev.sessions[serverId]?.serverInfo?.features?.composerDraftsSync === true;
    if (!prevEnabled && nextEnabled && !bridge.pulled) {
      void initialPull(bridge);
    }
  });

  void initialPull(bridge);

  return () => stopBridge(bridge);
}
