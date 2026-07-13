import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Marks a workspace terminal as an SSH (remote) session. SSH terminals live in
// every real workspace's tab bar on their daemon (so they reuse the draggable
// tabs + TerminalPane), but the panel needs to know they're remote: disable
// local file-link resolution and show the host label instead of "Terminal".
// Keyed by the daemon terminalId. Persisted because the tab itself is
// persisted by the layout store — after a reload we must still know a
// restored tab is remote.
export interface SshTerminalMeta {
  hostId: string;
  label: string;
  // Owning daemon session id — scopes global SSH auto-open to the right host.
  // Optional for older persisted entries (treated as matching every server).
  serverId?: string;
  // Cached remote OS slug (from host platform detect). Persisted so tab icons
  // still show the brand badge after a hard refresh before the hosts query
  // returns, and when the hosts list is briefly empty.
  os?: string | null;
}

interface SshTerminalMetaState {
  metaByTerminalId: Record<string, SshTerminalMeta>;
  register: (terminalId: string, meta: SshTerminalMeta) => void;
  patch: (terminalId: string, patch: Partial<SshTerminalMeta>) => void;
  unregister: (terminalId: string) => void;
}

export const useSshTerminalMetaStore = create<SshTerminalMetaState>()(
  persist(
    (set) => ({
      metaByTerminalId: {},
      register: (terminalId, meta) =>
        set((state) => ({
          metaByTerminalId: { ...state.metaByTerminalId, [terminalId]: meta },
        })),
      patch: (terminalId, patch) =>
        set((state) => {
          const existing = state.metaByTerminalId[terminalId];
          if (!existing) {
            return state;
          }
          return {
            metaByTerminalId: {
              ...state.metaByTerminalId,
              [terminalId]: { ...existing, ...patch },
            },
          };
        }),
      unregister: (terminalId) =>
        set((state) => {
          if (!(terminalId in state.metaByTerminalId)) {
            return state;
          }
          const next = { ...state.metaByTerminalId };
          delete next[terminalId];
          return { metaByTerminalId: next };
        }),
    }),
    {
      name: "ssh-terminal-meta",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// Stable per-terminal selector — returns null (a stable reference) for local
// terminals, so TerminalPanel doesn't re-render on unrelated meta changes.
export function useSshTerminalMeta(terminalId: string): SshTerminalMeta | null {
  return useSshTerminalMetaStore((state) => state.metaByTerminalId[terminalId] ?? null);
}

export function registerSshTerminal(terminalId: string, meta: SshTerminalMeta): void {
  useSshTerminalMetaStore.getState().register(terminalId, meta);
}

export function patchSshTerminalMeta(terminalId: string, patch: Partial<SshTerminalMeta>): void {
  useSshTerminalMetaStore.getState().patch(terminalId, patch);
}

export function unregisterSshTerminal(terminalId: string): void {
  useSshTerminalMetaStore.getState().unregister(terminalId);
}
