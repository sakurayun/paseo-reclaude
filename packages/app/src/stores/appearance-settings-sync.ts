import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { isWeb } from "@/constants/platform";
import { persistAppSettings } from "@/hooks/use-settings";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  extractSyncedAppearance,
  pickSyncedAppearance,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { queryClient as appQueryClient } from "@/query/query-client";
import { useSessionStore } from "@/stores/session-store";

const PUSH_DEBOUNCE_MS = 300;

// Mirrors prompt-presets-sync, but the synced store is the React Query-backed
// AppSettings cache rather than a Zustand store, and only the appearance subset
// (theme + syntax theme + terminal color scheme) is synced. Echo loops are
// prevented by a single JSON-dedupe guard (`lastSyncedJson`): every push and
// every applied remote update records the synced-subset JSON it produced, so the
// cache notification that follows is recognized as a no-op. The `applyingRemote`
// flag is a belt-and-suspenders for the async persist window.
interface AppearanceSyncBridge {
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

const bridgesByServerId = new Map<string, AppearanceSyncBridge>();

function readSynced(): { settings: Record<string, unknown>; json: string } {
  const settings =
    appQueryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? DEFAULT_CLIENT_SETTINGS;
  const synced = extractSyncedAppearance(settings);
  return { settings: synced, json: JSON.stringify(synced) };
}

function isFeatureEnabled(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.appearanceSettingsSync ===
    true
  );
}

function applyRemote(
  bridge: AppearanceSyncBridge,
  revision: number,
  raw: Record<string, unknown>,
): void {
  bridge.revision = revision;
  const updates = pickSyncedAppearance(raw);
  if (Object.keys(updates).length === 0) {
    return;
  }
  const current =
    appQueryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? DEFAULT_CLIENT_SETTINGS;
  // Record the synced-subset JSON the apply will produce BEFORE persisting, so the
  // cache notification fired by persistAppSettings is deduped and not echoed back.
  bridge.lastSyncedJson = JSON.stringify(extractSyncedAppearance({ ...current, ...updates }));
  bridge.applyingRemote = true;
  void persistAppSettings(updates).finally(() => {
    queueMicrotask(() => {
      bridge.applyingRemote = false;
    });
  });
}

async function pushSettings(
  bridge: AppearanceSyncBridge,
  settings: Record<string, unknown>,
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
    const result = await bridge.client.pushAppearanceSettings({ revision, settings });
    if (!result.accepted) {
      // A peer won the race; adopt the daemon's authoritative envelope instead.
      bridge.revision = result.revision;
      const envelope = await bridge.client.getAppearanceSettings();
      if (!bridge.stopped && envelope.revision >= bridge.revision) {
        applyRemote(bridge, envelope.revision, envelope.settings);
      }
    }
  } catch {
    // Transient sync failure; the next local edit retries.
  }
}

function schedulePush(
  bridge: AppearanceSyncBridge,
  settings: Record<string, unknown>,
  json: string,
): void {
  if (bridge.pushTimer) {
    clearTimeout(bridge.pushTimer);
  }
  bridge.pushTimer = setTimeout(() => {
    bridge.pushTimer = null;
    void pushSettings(bridge, settings, json);
  }, PUSH_DEBOUNCE_MS);
}

function onCacheChange(bridge: AppearanceSyncBridge): void {
  if (
    bridge.stopped ||
    bridge.applyingRemote ||
    !bridge.pulled ||
    !isFeatureEnabled(bridge.serverId)
  ) {
    return;
  }
  const { settings, json } = readSynced();
  if (json === bridge.lastSyncedJson) {
    return;
  }
  schedulePush(bridge, settings, json);
}

async function initialPull(bridge: AppearanceSyncBridge): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  try {
    const local = readSynced();
    const envelope = await bridge.client.getAppearanceSettings();
    if (bridge.stopped) {
      return;
    }
    bridge.pulled = true;
    if (envelope.revision === 0) {
      // Empty daemon store. Seed it from desktop/web only so a freshly connected
      // mobile adopts the desktop's appearance instead of imposing its own. Mobile
      // still propagates explicit changes once the store is non-empty.
      if (isWeb) {
        bridge.revision = 0;
        await pushSettings(bridge, local.settings, local.json);
      }
      return;
    }
    applyRemote(bridge, envelope.revision, envelope.settings);
  } catch {
    bridge.pulled = true;
  }
}

function stopBridge(bridge: AppearanceSyncBridge): void {
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

export function startAppearanceSettingsSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;
  const existing = bridgesByServerId.get(serverId);
  if (existing) {
    stopBridge(existing);
  }

  const bridge: AppearanceSyncBridge = {
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
    if (event.query.queryKey?.[0] !== APP_SETTINGS_QUERY_KEY[0]) {
      return;
    }
    onCacheChange(bridge);
  });

  bridge.unsubscribeChanged = client.on("appearance.settings.changed", (msg) => {
    if (msg.type !== "appearance.settings.changed") {
      return;
    }
    if (bridge.stopped || !isFeatureEnabled(serverId)) {
      return;
    }
    if (msg.payload.revision <= bridge.revision) {
      return;
    }
    bridge.pulled = true;
    applyRemote(bridge, msg.payload.revision, msg.payload.settings);
  });

  bridge.unsubscribeSession = useSessionStore.subscribe((next, prev) => {
    const nextEnabled =
      next.sessions[serverId]?.serverInfo?.features?.appearanceSettingsSync === true;
    const prevEnabled =
      prev.sessions[serverId]?.serverInfo?.features?.appearanceSettingsSync === true;
    if (!prevEnabled && nextEnabled && !bridge.pulled) {
      void initialPull(bridge);
    }
  });

  void initialPull(bridge);

  return () => stopBridge(bridge);
}
