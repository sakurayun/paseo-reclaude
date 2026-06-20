import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { useCommitMessagePresetsStore } from "@/git/commit-message-presets-store";
import { useSessionStore } from "@/stores/session-store";

const PUSH_DEBOUNCE_MS = 300;

interface PromptPresetsSyncBridge {
  serverId: string;
  client: DaemonClient;
  revision: number;
  applyingRemote: boolean;
  pulled: boolean;
  lastSyncedJson: string;
  pushTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeStore: (() => void) | null;
  unsubscribeChanged: (() => void) | null;
  unsubscribeSession: (() => void) | null;
  stopped: boolean;
}

const bridgesByServerId = new Map<string, PromptPresetsSyncBridge>();

function presetsJson(presets: readonly string[]): string {
  return JSON.stringify(presets);
}

function isFeatureEnabled(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.promptPresetsSync === true
  );
}

function applyRemote(bridge: PromptPresetsSyncBridge, revision: number, presets: string[]): void {
  bridge.revision = revision;
  bridge.lastSyncedJson = presetsJson(presets);
  bridge.applyingRemote = true;
  try {
    useCommitMessagePresetsStore.getState().replacePresets(presets);
  } finally {
    queueMicrotask(() => {
      bridge.applyingRemote = false;
    });
  }
}

async function pushPresets(bridge: PromptPresetsSyncBridge, presets: string[]): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  const json = presetsJson(presets);
  if (json === bridge.lastSyncedJson) {
    return;
  }
  const revision = bridge.revision + 1;
  bridge.revision = revision;
  bridge.lastSyncedJson = json;
  try {
    const result = await bridge.client.pushPromptPresets({ revision, presets });
    if (!result.accepted) {
      bridge.revision = result.revision;
      const envelope = await bridge.client.getPromptPresets();
      if (!bridge.stopped && envelope.revision >= bridge.revision) {
        applyRemote(bridge, envelope.revision, envelope.presets);
      }
    }
  } catch {
    // Transient sync failure; the next local edit retries.
  }
}

function schedulePush(bridge: PromptPresetsSyncBridge, presets: string[]): void {
  if (bridge.pushTimer) {
    clearTimeout(bridge.pushTimer);
  }
  bridge.pushTimer = setTimeout(() => {
    bridge.pushTimer = null;
    void pushPresets(bridge, presets);
  }, PUSH_DEBOUNCE_MS);
}

async function initialPull(bridge: PromptPresetsSyncBridge): Promise<void> {
  if (bridge.stopped || !isFeatureEnabled(bridge.serverId)) {
    return;
  }
  try {
    const localPresets = useCommitMessagePresetsStore.getState().presets;
    const envelope = await bridge.client.getPromptPresets();
    if (bridge.stopped) {
      return;
    }
    bridge.pulled = true;
    if (envelope.revision === 0 && localPresets.length > 0) {
      bridge.revision = 0;
      await pushPresets(bridge, localPresets);
      return;
    }
    applyRemote(bridge, envelope.revision, envelope.presets);
  } catch {
    bridge.pulled = true;
  }
}

function stopBridge(bridge: PromptPresetsSyncBridge): void {
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

export function startPromptPresetsSync(params: {
  serverId: string;
  client: DaemonClient;
}): () => void {
  const { serverId, client } = params;
  const existing = bridgesByServerId.get(serverId);
  if (existing) {
    stopBridge(existing);
  }

  const bridge: PromptPresetsSyncBridge = {
    serverId,
    client,
    revision: 0,
    applyingRemote: false,
    pulled: false,
    lastSyncedJson: "",
    pushTimer: null,
    unsubscribeStore: null,
    unsubscribeChanged: null,
    unsubscribeSession: null,
    stopped: false,
  };
  bridgesByServerId.set(serverId, bridge);

  bridge.unsubscribeStore = useCommitMessagePresetsStore.subscribe((next, prev) => {
    if (
      bridge.stopped ||
      bridge.applyingRemote ||
      !bridge.pulled ||
      !isFeatureEnabled(serverId) ||
      next.presets === prev.presets
    ) {
      return;
    }
    schedulePush(bridge, next.presets);
  });

  bridge.unsubscribeChanged = client.on("prompt.presets.changed", (msg) => {
    if (msg.type !== "prompt.presets.changed") {
      return;
    }
    if (bridge.stopped || !isFeatureEnabled(serverId)) {
      return;
    }
    if (msg.payload.revision <= bridge.revision) {
      return;
    }
    bridge.pulled = true;
    applyRemote(bridge, msg.payload.revision, msg.payload.presets);
  });

  bridge.unsubscribeSession = useSessionStore.subscribe((next, prev) => {
    const nextEnabled = next.sessions[serverId]?.serverInfo?.features?.promptPresetsSync === true;
    const prevEnabled = prev.sessions[serverId]?.serverInfo?.features?.promptPresetsSync === true;
    if (!prevEnabled && nextEnabled && !bridge.pulled) {
      void initialPull(bridge);
    }
  });

  void initialPull(bridge);

  return () => stopBridge(bridge);
}
