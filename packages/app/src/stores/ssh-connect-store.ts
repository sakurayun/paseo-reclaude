import { create } from "zustand";
import type { SshObservedHostKey } from "@getpaseo/protocol/messages";

export type SshConnectStatus = "connecting" | "auth_failed" | "mismatch" | "error" | "connected";

export interface SshConnectLogLine {
  line: string;
  level: "info" | "error";
}

// Live state for one in-flight SSH connect attempt, rendered by the
// ssh-connecting tab and driven by run-ssh-connect. Ephemeral (not persisted):
// the connecting tab is stripped from persisted/synced layouts.
export interface SshConnectState {
  connectId: string;
  serverId: string;
  hostId: string;
  workspaceId: string;
  cwd: string | null;
  label: string;
  os: string | null;
  status: SshConnectStatus;
  error: string | null;
  observedKey: SshObservedHostKey | null;
  // Whether the current attempt is using an inline password override, so a
  // success can offer to persist it.
  usedPasswordOverride: boolean;
  log: SshConnectLogLine[];
}

interface SshConnectStoreState {
  byId: Record<string, SshConnectState>;
  start: (state: SshConnectState) => void;
  appendLog: (connectId: string, line: SshConnectLogLine) => void;
  patch: (connectId: string, patch: Partial<SshConnectState>) => void;
  remove: (connectId: string) => void;
}

const MAX_LOG_LINES = 500;

export const useSshConnectStore = create<SshConnectStoreState>()((set) => ({
  byId: {},
  start: (state) => set((prev) => ({ byId: { ...prev.byId, [state.connectId]: state } })),
  appendLog: (connectId, line) =>
    set((prev) => {
      const current = prev.byId[connectId];
      if (!current) {
        return prev;
      }
      const log = [...current.log, line].slice(-MAX_LOG_LINES);
      return { byId: { ...prev.byId, [connectId]: { ...current, log } } };
    }),
  patch: (connectId, patch) =>
    set((prev) => {
      const current = prev.byId[connectId];
      if (!current) {
        return prev;
      }
      return { byId: { ...prev.byId, [connectId]: { ...current, ...patch } } };
    }),
  remove: (connectId) =>
    set((prev) => {
      if (!(connectId in prev.byId)) {
        return prev;
      }
      const next = { ...prev.byId };
      delete next[connectId];
      return { byId: next };
    }),
}));

// Stable per-connect selector for the connecting panel.
export function useSshConnectState(connectId: string): SshConnectState | null {
  return useSshConnectStore((state) => state.byId[connectId] ?? null);
}

// The connectId of an in-flight (not yet connected) attempt for a host, so a
// repeat click focuses the existing connecting tab instead of starting another.
export function findInFlightConnectIdByHost(serverId: string, hostId: string): string | null {
  const { byId } = useSshConnectStore.getState();
  for (const state of Object.values(byId)) {
    if (state.serverId === serverId && state.hostId === hostId && state.status !== "connected") {
      return state.connectId;
    }
  }
  return null;
}
