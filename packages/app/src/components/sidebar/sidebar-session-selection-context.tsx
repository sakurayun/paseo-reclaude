import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { isWeb } from "@/constants/platform";
import {
  applySidebarSessionSelection,
  createEmptySidebarSessionSelection,
  parseSidebarSessionSelectionKey,
  readPointerSelectionMode,
  type SidebarSessionSelectionKey,
  type SidebarSessionSelectionState,
} from "@/components/sidebar/sidebar-session-selection";

export interface SidebarSessionSelectionContextValue {
  selectedKeys: ReadonlySet<SidebarSessionSelectionKey>;
  selectedCount: number;
  isSelected: (key: SidebarSessionSelectionKey) => boolean;
  /**
   * Handle a row press. Returns true when the press was consumed for multi-select
   * (caller should not navigate). Returns false for a plain replace/open press.
   */
  handleRowPress: (input: { key: SidebarSessionSelectionKey; event?: unknown }) => boolean;
  clearSelection: () => void;
  /** Drop multi-select when opening a single-item context menu on an unselected row. */
  prepareContextMenu: (key: SidebarSessionSelectionKey) => void;
  getSelectedTargets: () => Array<{ serverId: string; agentId: string }>;
}

const SidebarSessionSelectionContext = createContext<SidebarSessionSelectionContextValue | null>(
  null,
);

export function useSidebarSessionSelection(): SidebarSessionSelectionContextValue | null {
  return useContext(SidebarSessionSelectionContext);
}

interface SidebarSessionSelectionProviderProps extends PropsWithChildren {
  /**
   * Visual order of session keys currently rendered. Shift-range selection uses
   * this list; keys that leave the list are pruned from the selection.
   */
  orderedKeys: readonly SidebarSessionSelectionKey[];
}

export function SidebarSessionSelectionProvider({
  orderedKeys,
  children,
}: SidebarSessionSelectionProviderProps) {
  const [state, setState] = useState<SidebarSessionSelectionState>(
    createEmptySidebarSessionSelection,
  );

  // Drop selection entries that are no longer visible (archived, filtered, etc.).
  useEffect(() => {
    setState((current) => {
      if (current.selectedKeys.size === 0) {
        return current;
      }
      const visible = new Set(orderedKeys);
      let changed = false;
      const nextSelected = new Set<SidebarSessionSelectionKey>();
      for (const key of current.selectedKeys) {
        if (visible.has(key)) {
          nextSelected.add(key);
        } else {
          changed = true;
        }
      }
      const nextAnchor =
        current.anchorKey && visible.has(current.anchorKey) ? current.anchorKey : null;
      if (!changed && nextAnchor === current.anchorKey) {
        return current;
      }
      return {
        selectedKeys: nextSelected,
        anchorKey: nextAnchor,
      };
    });
  }, [orderedKeys]);

  // Escape clears multi-select on web/desktop.
  useEffect(() => {
    if (!isWeb || state.selectedKeys.size === 0) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setState(createEmptySidebarSessionSelection());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.selectedKeys.size]);

  const clearSelection = useCallback(() => {
    setState(createEmptySidebarSessionSelection());
  }, []);

  const isSelected = useCallback(
    (key: SidebarSessionSelectionKey) => state.selectedKeys.has(key),
    [state.selectedKeys],
  );

  const handleRowPress = useCallback(
    (input: { key: SidebarSessionSelectionKey; event?: unknown }) => {
      const mode = readPointerSelectionMode(input.event);
      if (mode === "replace") {
        // Plain click: clear multi-select so navigation stays a single-select action.
        setState(createEmptySidebarSessionSelection());
        return false;
      }
      setState((current) =>
        applySidebarSessionSelection({
          state: current,
          orderedKeys,
          targetKey: input.key,
          mode,
        }),
      );
      return true;
    },
    [orderedKeys],
  );

  const prepareContextMenu = useCallback((key: SidebarSessionSelectionKey) => {
    setState((current) => {
      if (current.selectedKeys.size <= 1) {
        return current;
      }
      if (current.selectedKeys.has(key)) {
        return current;
      }
      // Right-click on a non-selected row while multi-selecting: fall back to that row only.
      return {
        selectedKeys: new Set([key]),
        anchorKey: key,
      };
    });
  }, []);

  const getSelectedTargets = useCallback(() => {
    const targets: Array<{ serverId: string; agentId: string }> = [];
    for (const key of state.selectedKeys) {
      const parsed = parseSidebarSessionSelectionKey(key);
      if (parsed) {
        targets.push(parsed);
      }
    }
    return targets;
  }, [state.selectedKeys]);

  const value = useMemo<SidebarSessionSelectionContextValue>(
    () => ({
      selectedKeys: state.selectedKeys,
      selectedCount: state.selectedKeys.size,
      isSelected,
      handleRowPress,
      clearSelection,
      prepareContextMenu,
      getSelectedTargets,
    }),
    [
      state.selectedKeys,
      isSelected,
      handleRowPress,
      clearSelection,
      prepareContextMenu,
      getSelectedTargets,
    ],
  );

  return (
    <SidebarSessionSelectionContext.Provider value={value}>
      {children}
    </SidebarSessionSelectionContext.Provider>
  );
}
