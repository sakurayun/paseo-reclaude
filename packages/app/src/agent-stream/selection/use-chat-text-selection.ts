import type { ChatTextSelection } from "./types";

const NOOP = () => {};

/**
 * Native stub — the selection bubble is a web/DOM-only feature (it relies on
 * `window.getSelection()`). Native gets the OS selection menu instead.
 */
export function useChatTextSelection(_enabled: boolean): {
  selection: ChatTextSelection | null;
  clear: () => void;
} {
  return { selection: null, clear: NOOP };
}
