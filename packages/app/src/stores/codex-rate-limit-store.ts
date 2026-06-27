import { create } from "zustand";

// COMPAT(codexRateLimitReset): transient, client-only flags marking that a Codex
// agent's most recent turn failed on a usage/rate limit. Drives the rate-limit
// reset card at the end of that agent's stream. Set from the agent_stream
// handler on a rate-limit `turn_failed`; cleared when a new turn starts /
// completes or after a successful reset. Not persisted.
interface CodexRateLimitState {
  hits: Record<string, boolean>;
  setHit: (serverId: string, agentId: string, hit: boolean) => void;
}

export function codexRateLimitKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

// Mirrors the daemon's heuristic (codex-app-server-agent.ts) so a rate-limit
// failure is recognized even from older daemons that don't set the `code`.
const RATE_LIMIT_TEXT_PATTERN =
  /rate.?limit|usage limit|usage cap|limit reached|quota|too many requests|\b429\b/i;

export function isRateLimitErrorText(text: string | null | undefined): boolean {
  return typeof text === "string" && RATE_LIMIT_TEXT_PATTERN.test(text);
}

export const useCodexRateLimitStore = create<CodexRateLimitState>((set) => ({
  hits: {},
  setHit: (serverId, agentId, hit) =>
    set((state) => {
      const key = codexRateLimitKey(serverId, agentId);
      if (Boolean(state.hits[key]) === hit) {
        return state;
      }
      const next = { ...state.hits };
      if (hit) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return { hits: next };
    }),
}));
