import { create } from "zustand";

/**
 * A pending request to focus a query inside a specific agent's stream. Set when
 * the user picks a global cross-session search result, consumed by that agent's
 * AgentStreamView once its history is ready — which opens the in-session find bar
 * with the query (reusing the Phase A search/highlight/scroll pipeline) so the
 * match is highlighted and scrolled into view.
 */
export interface SessionSearchFocusRequest {
  agentId: string;
  query: string;
  /** Best-effort target row id; the view falls back to the first match when absent. */
  itemId?: string;
  /** Monotonic token so a view only handles each request once. */
  token: number;
}

interface SessionSearchFocusState {
  request: SessionSearchFocusRequest | null;
  requestFocus(input: { agentId: string; query: string; itemId?: string }): void;
  consumeFocus(agentId: string): SessionSearchFocusRequest | null;
}

let nextFocusToken = 1;

export const useSessionSearchFocusStore = create<SessionSearchFocusState>((set, get) => ({
  request: null,
  requestFocus: (input) => {
    const token = nextFocusToken;
    nextFocusToken += 1;
    set({
      request: { agentId: input.agentId, query: input.query, itemId: input.itemId, token },
    });
  },
  consumeFocus: (agentId) => {
    const current = get().request;
    if (!current || current.agentId !== agentId) {
      return null;
    }
    set({ request: null });
    return current;
  },
}));
