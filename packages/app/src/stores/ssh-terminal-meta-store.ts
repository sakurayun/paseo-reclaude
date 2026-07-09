import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Marks a workspace terminal as an SSH (remote) session. SSH terminals live in
// a real workspace's tab bar (so they reuse the draggable tabs + TerminalPane),
// but the panel needs to know they're remote: disable local file-link
// resolution and show the host label instead of "Terminal". Keyed by the
// daemon terminalId. Persisted because the tab itself is persisted by the
// layout store — after a reload we must still know a restored tab is remote.
export interface SshTerminalMeta {
  hostId: string;
  label: string;
}

interface SshTerminalMetaState {
  metaByTerminalId: Record<string, SshTerminalMeta>;
  register: (terminalId: string, meta: SshTerminalMeta) => void;
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

export function unregisterSshTerminal(terminalId: string): void {
  useSshTerminalMetaStore.getState().unregister(terminalId);
}
