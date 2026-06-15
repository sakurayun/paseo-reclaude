import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SidebarGroupMode = "project" | "workspace" | "status";

interface SidebarViewStoreState {
  groupModeByServerId: Record<string, SidebarGroupMode>;
  getGroupMode: (serverId: string) => SidebarGroupMode;
  setGroupMode: (serverId: string, mode: SidebarGroupMode) => void;
}

export const useSidebarViewStore = create<SidebarViewStoreState>()(
  persist(
    (set, get) => ({
      groupModeByServerId: {},
      getGroupMode: (serverId) => {
        const key = serverId.trim();
        // Default the sidebar workspace section to grouping by workspace.
        if (!key) return "workspace";
        return get().groupModeByServerId[key] ?? "workspace";
      },
      setGroupMode: (serverId, mode) => {
        const key = serverId.trim();
        if (!key) return;
        set((state) => ({
          groupModeByServerId: {
            ...state.groupModeByServerId,
            [key]: mode,
          },
        }));
      },
    }),
    {
      name: "sidebar-group-mode",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        groupModeByServerId: state.groupModeByServerId,
      }),
    },
  ),
);
