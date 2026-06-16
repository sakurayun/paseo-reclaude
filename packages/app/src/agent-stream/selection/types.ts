/** Viewport-coordinate rect of the active chat text selection (web only). */
export interface ChatTextSelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A non-empty text selection inside the chat message stream. */
export interface ChatTextSelection {
  text: string;
  rect: ChatTextSelectionRect;
}

export interface ChatSelectionBubbleProps {
  /** Active selection, or null to hide the bubble. */
  selection: ChatTextSelection | null;
  /** Append the selected text to the current composer. */
  onAsk: (text: string) => void;
  /** Open a new agent window (right split) seeded with the selected text. */
  onAskInNewWindow: (text: string) => void;
  /** Save the selected text as a reusable prompt preset. */
  onSavePreset: (text: string) => void;
}
