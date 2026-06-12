import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * User-defined commit message presets for the source control changes box.
 * Global (not per-repo): conventional prefixes like "feat: " or release
 * boilerplate are the same everywhere.
 */
interface CommitMessagePresetsState {
  presets: string[];
  addPreset: (text: string) => void;
  removePreset: (text: string) => void;
}

function normalizePreset(text: string): string {
  return text.trim();
}

export const useCommitMessagePresetsStore = create<CommitMessagePresetsState>()(
  persist(
    (set) => ({
      presets: [],
      addPreset: (text) => {
        const normalized = normalizePreset(text);
        if (!normalized) {
          return;
        }
        set((state) =>
          state.presets.includes(normalized) ? state : { presets: [...state.presets, normalized] },
        );
      },
      removePreset: (text) => {
        set((state) => {
          const filtered = state.presets.filter((preset) => preset !== text);
          return filtered.length === state.presets.length ? state : { presets: filtered };
        });
      },
    }),
    {
      name: "commit-message-presets",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
