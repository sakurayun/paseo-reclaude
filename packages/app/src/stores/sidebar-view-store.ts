import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type SidebarGroupMode = "project" | "workspace" | "status";

// Which content the sidebar body shows: the agent/session list or the SSH host
// manager. Ephemeral (not persisted) so the sidebar always opens on sessions.
export type SidebarContentMode = "sessions" | "ssh";

const SIDEBAR_VIEW_STORAGE_KEY = "sidebar-view";
const LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY = "sidebar-group-mode";
const SIDEBAR_VIEW_STORE_VERSION = 2;

interface SidebarViewStoreState {
  groupMode: SidebarGroupMode;
  hostFilters: string[];
  searchQuery: string;
  contentMode: SidebarContentMode;
  setGroupMode: (mode: SidebarGroupMode) => void;
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  setSearchQuery: (query: string) => void;
  reconcileHostFilters: (serverIds: readonly string[]) => void;
  setContentMode: (mode: SidebarContentMode) => void;
  toggleContentMode: () => void;
}

interface SidebarViewPersistedState {
  groupMode: SidebarGroupMode;
  hostFilters: string[];
  searchQuery: string;
}

function isSidebarGroupMode(value: unknown): value is SidebarGroupMode {
  return value === "project" || value === "workspace" || value === "status";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLegacyGroupMode(persistedState: Record<string, unknown>): SidebarGroupMode | null {
  const groupModeByServerId = persistedState.groupModeByServerId;
  if (!isRecord(groupModeByServerId)) {
    return null;
  }

  const modes = Object.values(groupModeByServerId).filter(isSidebarGroupMode);
  if (modes.length === 0) return null;
  return modes.includes("status") ? "status" : "project";
}

function readHostFilters(persistedState: Record<string, unknown>): string[] {
  const hostFilters = persistedState.hostFilters;
  if (Array.isArray(hostFilters)) {
    return hostFilters.filter((value): value is string => typeof value === "string");
  }
  // COMPAT(sidebarHostFilters): added in v0.1.120, remove after 2027-01-01 once
  // pre-v2 persisted sidebar state (a single `hostFilter` string) has aged out.
  const legacyHostFilter = persistedState.hostFilter;
  return typeof legacyHostFilter === "string" ? [legacyHostFilter] : [];
}

export function migrateSidebarViewState(persistedState: unknown): SidebarViewPersistedState {
  if (!isRecord(persistedState)) {
    return { groupMode: "project", hostFilters: [], searchQuery: "" };
  }

  const searchQuery =
    typeof persistedState.searchQuery === "string" ? persistedState.searchQuery : "";

  const legacyGroupMode = readLegacyGroupMode(persistedState);
  if (legacyGroupMode) {
    return { groupMode: legacyGroupMode, hostFilters: [], searchQuery };
  }

  return {
    groupMode: isSidebarGroupMode(persistedState.groupMode) ? persistedState.groupMode : "project",
    hostFilters: readHostFilters(persistedState),
    searchQuery,
  };
}

export function createSidebarViewStorage(
  backingStorage: StateStorage = AsyncStorage,
): StateStorage {
  return {
    getItem: async (name) => {
      const value = await backingStorage.getItem(name);
      if (value !== null || name !== SIDEBAR_VIEW_STORAGE_KEY) {
        return value;
      }
      return backingStorage.getItem(LEGACY_SIDEBAR_GROUP_MODE_STORAGE_KEY);
    },
    setItem: (name, value) => backingStorage.setItem(name, value),
    removeItem: (name) => backingStorage.removeItem(name),
  };
}

export const useSidebarViewStore = create<SidebarViewStoreState>()(
  persist(
    (set) => ({
      groupMode: "project",
      hostFilters: [],
      searchQuery: "",
      contentMode: "sessions",
      setGroupMode: (mode) => set({ groupMode: mode }),
      setContentMode: (mode) => set({ contentMode: mode }),
      toggleContentMode: () =>
        set((state) => ({ contentMode: state.contentMode === "ssh" ? "sessions" : "ssh" })),
      toggleHostFilter: (serverId) =>
        set((state) => ({
          hostFilters: state.hostFilters.includes(serverId)
            ? state.hostFilters.filter((id) => id !== serverId)
            : [...state.hostFilters, serverId],
        })),
      clearHostFilters: () => set({ hostFilters: [] }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      reconcileHostFilters: (serverIds) =>
        set((state) => {
          if (state.hostFilters.length === 0) {
            return state;
          }
          const allowed = new Set(serverIds);
          const next = state.hostFilters.filter((id) => allowed.has(id));
          if (next.length === state.hostFilters.length) {
            return state;
          }
          return { hostFilters: next };
        }),
    }),
    {
      name: SIDEBAR_VIEW_STORAGE_KEY,
      version: SIDEBAR_VIEW_STORE_VERSION,
      storage: createJSONStorage(createSidebarViewStorage),
      partialize: (state) => ({
        groupMode: state.groupMode,
        hostFilters: state.hostFilters,
        searchQuery: state.searchQuery,
      }),
      migrate: migrateSidebarViewState,
    },
  ),
);
