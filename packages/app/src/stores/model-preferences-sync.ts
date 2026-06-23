import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { isWeb } from "@/constants/platform";
import {
  DEFAULT_FORM_PREFERENCES,
  parseFormPreferences,
  type FormPreferences,
} from "@/create-agent-preferences/preferences";
import { createAgentPreferencesService } from "@/create-agent-preferences/service";
import { FORM_PREFERENCES_QUERY_KEY } from "@/hooks/use-form-preferences";
import { queryClient as appQueryClient } from "@/query/query-client";
import { useSessionStore } from "@/stores/session-store";

const PUSH_DEBOUNCE_MS = 300;

// Mirrors appearance-settings-sync: the synced store is the React Query-backed
// create-agent "form preferences" cache (last-used provider/model/mode, favorite
// models, per-model thinking + feature settings), shared across every connected
// client — mobile included — so model selection habits follow the user. Echo loops
// are prevented by a single JSON-dedupe guard (`lastSyncedJson`): every push and
// every applied remote update records the synced-subset JSON it produced, so the
// cache notification that follows is recognized as a no-op. The `applyingRemote`
// flag is a belt-and-suspenders for the async persist window.
interface ModelPreferencesSyncBridge {
  serverId: string;
  client: DaemonClient;
  revision: number;
  applyingRemote: boolean;
  pulled: boolean;
  lastSyncedJson: string;
  pushTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeCache: (() => void) | null;
  unsubscribeChanged: (() => void) | null;
  unsubscribeSession: (() => void) | null;
  stopped: boolean;
}

const bridgesByServerId = new Map<string, ModelPreferencesSyncBridge>();

// The synced subset of FormPreferences. Today the entire blob syncs. To make a
// field device-local, omit it here — the opaque protocol blob never changes.
function extractSynced(preferences: FormPreferences): Record<string, unknown> {
  return { ...preferences };
}

function readSynced(): { preferences: Record<string, unknown>; json: string } {
  const preferences =
    appQueryClient.getQueryData<FormPreferences>(FORM_PREFERENCES_QUERY_KEY) ??
    DEFAULT_FORM_PREFERENCES;
  const synced = extractSynced(preferences);
  return { preferences: synced, json: JSON.stringify(synced) };
}

function isFeatureEnabled(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.modelPreferencesSync ===
    true
  );
}

function applyRemote(
  bridge: ModelPreferencesSyncBridge,
  revision: number,
  raw: Record<string, unknown>,
): void {
  bridge.revision = revision;
  // Re-validate the opaque blob with the same parser used on load; unknown/invalid
  // fields are dropped and provider/version-specific feature values are pruned at
  // read time downstream, so a malformed or newer peer can't inject bad state.
  const parsed = parseFormPreferences(raw);
  // Record the synced-subset JSON the apply will produce BEFORE persisting, so the
  // cache notification fired by setQueryData is deduped and not echoed back.
  bridge.lastSyncedJson = JSON.stringify(extractSynced(parsed));
  bridge.applyingRemote = true;
  void (async () => {
    try {
      const next = await createAgentPreferencesService.update(() => parsed);
      appQueryClient.setQueryData<FormPreferences>(FORM_PREFERENCES_QUERY_KEY, next);
    } finally {
      queueMicrotask(() => {
        bridge.applyingRemote = false;
      });
    }
  })();
}

async function pushPreferences(
  bridge: ModelPreferencesSyncBridge,
  preferences: Record<string, unknown>,
  json: string,
): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  if (json === bridge.lastSyncedJson) {
    return;
  }
  const revision = bridge.revision + 1;
  bridge.revision = revision;
  bridge.lastSyncedJson = json;
  try {
    const result = await bridge.client.pushModelPreferences({ revision, preferences });
    if (!result.accepted) {
      // A peer won the race; adopt the daemon's authoritative envelope instead.
      bridge.revision = result.revision;
      const envelope = await bridge.client.getModelPreferences();
      if (!bridge.stopped && envelope.revision >= bridge.revision) {
        applyRemote(bridge, envelope.revision, envelope.preferences);
      }
    }
  } catch {
    // Transient sync failure; the next local edit retries.
  }
}

function schedulePush(
  bridge: ModelPreferencesSyncBridge,
  preferences: Record<string, unknown>,
  json: string,
): void {
  if (bridge.pushTimer) {
    clearTimeout(bridge.pushTimer);
  }
  bridge.pushTimer = setTimeout(() => {
    bridge.pushTimer = null;
    void pushPreferences(bridge, preferences, json);
  }, PUSH_DEBOUNCE_MS);
}

function onCacheChange(bridge: ModelPreferencesSyncBridge): void {
  if (
    bridge.stopped ||
    bridge.applyingRemote ||
    !bridge.pulled ||
    !isFeatureEnabled(bridge.serverId)
  ) {
    return;
  }
  const { preferences, json } = readSynced();
  if (json === bridge.lastSyncedJson) {
    return;
  }
  schedulePush(bridge, preferences, json);
}

async function initialPull(bridge: ModelPreferencesSyncBridge): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  try {
    // Prime the cache from local storage so seeding uses the real local prefs even
    // if no component has mounted useFormPreferences yet.
    const loaded = await createAgentPreferencesService.load();
    if (bridge.stopped) {
      return;
    }
    appQueryClient.setQueryData<FormPreferences>(
      FORM_PREFERENCES_QUERY_KEY,
      (prev) => prev ?? loaded,
    );
    const local = readSynced();
    const envelope = await bridge.client.getModelPreferences();
    if (bridge.stopped) {
      return;
    }
    bridge.pulled = true;
    if (envelope.revision === 0) {
      // Empty daemon store. Seed it from desktop/web only so a freshly connected
      // mobile adopts the desktop's model preferences instead of imposing its own.
      // Mobile still propagates explicit changes once the store is non-empty.
      if (isWeb) {
        bridge.revision = 0;
        await pushPreferences(bridge, local.preferences, local.json);
      }
      return;
    }
    applyRemote(bridge, envelope.revision, envelope.preferences);
  } catch {
    bridge.pulled = true;
  }
}

function stopBridge(bridge: ModelPreferencesSyncBridge): void {
  if (bridge.stopped) {
    return;
  }
  bridge.stopped = true;
  bridge.unsubscribeCache?.();
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

export function startModelPreferencesSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;
  const existing = bridgesByServerId.get(serverId);
  if (existing) {
    stopBridge(existing);
  }

  const bridge: ModelPreferencesSyncBridge = {
    serverId,
    client,
    revision: 0,
    applyingRemote: false,
    pulled: false,
    lastSyncedJson: "",
    pushTimer: null,
    unsubscribeCache: null,
    unsubscribeChanged: null,
    unsubscribeSession: null,
    stopped: false,
  };
  bridgesByServerId.set(serverId, bridge);

  bridge.unsubscribeCache = appQueryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey?.[0] !== FORM_PREFERENCES_QUERY_KEY[0]) {
      return;
    }
    onCacheChange(bridge);
  });

  bridge.unsubscribeChanged = client.on("model.preferences.changed", (msg) => {
    if (msg.type !== "model.preferences.changed") {
      return;
    }
    if (bridge.stopped || !isFeatureEnabled(serverId)) {
      return;
    }
    if (msg.payload.revision <= bridge.revision) {
      return;
    }
    bridge.pulled = true;
    applyRemote(bridge, msg.payload.revision, msg.payload.preferences);
  });

  bridge.unsubscribeSession = useSessionStore.subscribe((next, prev) => {
    const nextEnabled =
      next.sessions[serverId]?.serverInfo?.features?.modelPreferencesSync === true;
    const prevEnabled =
      prev.sessions[serverId]?.serverInfo?.features?.modelPreferencesSync === true;
    if (!prevEnabled && nextEnabled && !bridge.pulled) {
      void initialPull(bridge);
    }
  });

  void initialPull(bridge);

  return () => stopBridge(bridge);
}
