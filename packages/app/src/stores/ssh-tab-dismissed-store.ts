import { create } from "zustand";

/**
 * Per-workspace set of SSH terminal ids the user closed from the tab bar.
 * Reconcile must not auto-reopen those tabs (they remain live on the daemon
 * and can be reopened from the SSH list or sidebar).
 *
 * Ephemeral: not persisted. A reload re-surfaces live SSH tabs in workspaces
 * that still list them — matching agent-tab restore of running sessions.
 */
interface SshTabDismissedState {
  dismissedByWorkspace: Record<string, ReadonlySet<string>>;
  dismiss: (workspaceKey: string, terminalId: string) => void;
  undismiss: (workspaceKey: string, terminalId: string) => void;
  undismissEverywhere: (terminalId: string) => void;
  isDismissed: (workspaceKey: string, terminalId: string) => boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export const useSshTabDismissedStore = create<SshTabDismissedState>()((set, get) => ({
  dismissedByWorkspace: {},
  dismiss: (workspaceKey, terminalId) => {
    const key = workspaceKey.trim();
    const id = terminalId.trim();
    if (!key || !id) {
      return;
    }
    set((state) => {
      const previous = state.dismissedByWorkspace[key] ?? EMPTY_SET;
      if (previous.has(id)) {
        return state;
      }
      const next = new Set(previous);
      next.add(id);
      return {
        dismissedByWorkspace: {
          ...state.dismissedByWorkspace,
          [key]: next,
        },
      };
    });
  },
  undismiss: (workspaceKey, terminalId) => {
    const key = workspaceKey.trim();
    const id = terminalId.trim();
    if (!key || !id) {
      return;
    }
    set((state) => {
      const previous = state.dismissedByWorkspace[key];
      if (!previous?.has(id)) {
        return state;
      }
      const next = new Set(previous);
      next.delete(id);
      const dismissedByWorkspace = { ...state.dismissedByWorkspace };
      if (next.size === 0) {
        delete dismissedByWorkspace[key];
      } else {
        dismissedByWorkspace[key] = next;
      }
      return { dismissedByWorkspace };
    });
  },
  undismissEverywhere: (terminalId) => {
    const id = terminalId.trim();
    if (!id) {
      return;
    }
    set((state) => {
      let changed = false;
      const dismissedByWorkspace: Record<string, ReadonlySet<string>> = {};
      for (const [key, setIds] of Object.entries(state.dismissedByWorkspace)) {
        if (!setIds.has(id)) {
          dismissedByWorkspace[key] = setIds;
          continue;
        }
        changed = true;
        const next = new Set(setIds);
        next.delete(id);
        if (next.size > 0) {
          dismissedByWorkspace[key] = next;
        }
      }
      return changed ? { dismissedByWorkspace } : state;
    });
  },
  isDismissed: (workspaceKey, terminalId) => {
    const key = workspaceKey.trim();
    const id = terminalId.trim();
    if (!key || !id) {
      return false;
    }
    return get().dismissedByWorkspace[key]?.has(id) ?? false;
  },
}));

export function dismissSshTab(workspaceKey: string, terminalId: string): void {
  useSshTabDismissedStore.getState().dismiss(workspaceKey, terminalId);
}

export function undismissSshTab(workspaceKey: string, terminalId: string): void {
  useSshTabDismissedStore.getState().undismiss(workspaceKey, terminalId);
}

export function undismissSshTabEverywhere(terminalId: string): void {
  useSshTabDismissedStore.getState().undismissEverywhere(terminalId);
}

export function filterOutDismissedSshTerminalIds(input: {
  workspaceKey: string;
  terminalIds: readonly string[];
}): string[] {
  const dismissed =
    useSshTabDismissedStore.getState().dismissedByWorkspace[input.workspaceKey.trim()] ?? EMPTY_SET;
  if (dismissed.size === 0) {
    return [...input.terminalIds];
  }
  return input.terminalIds.filter((id) => !dismissed.has(id));
}
