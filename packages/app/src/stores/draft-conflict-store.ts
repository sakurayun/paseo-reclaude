import { create } from "zustand";

// When a composer draft is being edited locally and a *different* version arrives
// from another client, the draft-sync bridge protects the local input and records
// the diverging remote text here (keyed by draftKey) instead of discarding it. The
// composer surfaces it in a drawer so the user can keep typing (and watch the
// remote update / disappear when the peer sends) or overwrite their local input
// with the remote text. This is ephemeral conflict UI state — not persisted.
interface DraftConflictStore {
  conflicts: Record<string, string>;
  setConflict: (draftKey: string, text: string) => void;
  clearConflict: (draftKey: string) => void;
}

export const useDraftConflictStore = create<DraftConflictStore>((set) => ({
  conflicts: {},
  setConflict: (draftKey, text) =>
    set((state) => {
      if (state.conflicts[draftKey] === text) {
        return state;
      }
      return { conflicts: { ...state.conflicts, [draftKey]: text } };
    }),
  clearConflict: (draftKey) =>
    set((state) => {
      if (!(draftKey in state.conflicts)) {
        return state;
      }
      const conflicts = { ...state.conflicts };
      delete conflicts[draftKey];
      return { conflicts };
    }),
}));
