import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const CHANGES_PANEL_MIN_HEIGHT = 120;
export const CHANGES_PANEL_MAX_HEIGHT = 560;
export const CHANGES_PANEL_DEFAULT_HEIGHT = 240;

export function clampChangesPanelHeight(height: number): number {
  return Math.min(CHANGES_PANEL_MAX_HEIGHT, Math.max(CHANGES_PANEL_MIN_HEIGHT, Math.round(height)));
}

/** Remembered height of the changed-files area in the source control pane. */
interface ChangesPanelState {
  height: number;
  setHeight: (height: number) => void;
}

export const useChangesPanelStore = create<ChangesPanelState>()(
  persist(
    (set) => ({
      height: CHANGES_PANEL_DEFAULT_HEIGHT,
      setHeight: (height) => set({ height: clampChangesPanelHeight(height) }),
    }),
    {
      name: "source-control-changes-panel",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
