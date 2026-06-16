import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatTextSelection } from "./types";

// The chat stream's scroll container carries this testID (see agent-stream
// strategy-web.tsx). A selection counts only when both ends live inside one.
const STREAM_SELECTOR = '[data-testid="agent-chat-scroll"]';

function isWithinStream(node: Node | null): boolean {
  if (!node) {
    return false;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(STREAM_SELECTOR));
}

function readChatSelection(): ChatTextSelection | null {
  if (typeof window === "undefined") {
    return null;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString().trim();
  if (!text) {
    return null;
  }
  if (!isWithinStream(selection.anchorNode) || !isWithinStream(selection.focusNode)) {
    return null;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return {
    text,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  };
}

/**
 * Tracks the user's text selection inside the chat stream and exposes it (with a
 * viewport rect) so a floating bubble can anchor above it. `enabled` should be
 * the pane's focus state so only the focused pane reacts to a selection.
 */
export function useChatTextSelection(enabled: boolean): {
  selection: ChatTextSelection | null;
  clear: () => void;
} {
  const [selection, setSelection] = useState<ChatTextSelection | null>(null);
  const rafRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    setSelection(null);
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      setSelection(null);
      return;
    }
    const recompute = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setSelection(readChatSelection());
      });
    };
    // Scroll/resize keep the bubble glued to the (still-valid) selection.
    document.addEventListener("selectionchange", recompute);
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener("selectionchange", recompute);
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [enabled]);

  return { selection, clear };
}
