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
  replacePresets: (presets: string[]) => void;
}

function normalizePreset(text: string): string {
  return text.trim();
}

function normalizePresets(presets: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const preset of presets) {
    const value = normalizePreset(preset);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
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
      replacePresets: (presets) => {
        const normalized = normalizePresets(presets);
        set((state) =>
          JSON.stringify(state.presets) === JSON.stringify(normalized)
            ? state
            : { presets: normalized },
        );
      },
    }),
    {
      name: "commit-message-presets",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
