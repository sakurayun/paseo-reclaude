/**
 * Text-field style undo/redo for terminal deletes (selection-delete and
 * plain Backspace). Remember removed strings, then re-type or re-backspace
 * them on Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
 */

import { countEditorCharacters } from "./terminal-click-edit";

const DEFAULT_MAX_ENTRIES = 50;

/** Normalize selection text so it can be re-typed into a shell line editor. */
export function normalizeTextForShellReinsert(text: string): string {
  if (!text) {
    return "";
  }
  // Wrapped visual lines are joined without a real NL in the shell buffer;
  // strip hard breaks so undo doesn't submit the command mid-restore.
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "")
    .replace(/[\r\n]/g, "");
}

/** Backspace sequence that removes `text` again (redo after undo). */
export function buildRedoDeleteSequence(text: string): string {
  const count = countEditorCharacters(text);
  if (count <= 0) {
    return "";
  }
  return "\x7f".repeat(count);
}

/**
 * Input that should wipe the undo/redo stacks (cursor/edit generation changed).
 * Plain Backspace / forward-delete are excluded so consecutive deletes can undo.
 */
export function isEditHistoryBreakingInput(data: string): boolean {
  if (!data) {
    return false;
  }
  // Single backspace (DEL or BS) — we record these for undo.
  if (data === "\x7f" || data === "\x08") {
    return false;
  }
  // Forward delete (CSI 3~) — leave history alone if we ever record it.
  if (data === "\x1b[3~") {
    return false;
  }
  // Multi-backspace sequences from our inject path use isInjectingEditSequence;
  // any other multi-byte / printable / arrow / enter input breaks history.
  return true;
}

export class TerminalEditHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Consecutive plain Backspaces merge into one undo entry (like most editors). */
  private coalesceBackspace = false;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Record text removed by a selection-delete (starts a new undo entry). */
  pushDeleted(text: string): void {
    this.coalesceBackspace = false;
    this.pushUndoEntry(text);
  }

  /**
   * Record one character removed by plain Backspace. Consecutive backspaces
   * coalesce: deleting "c","b","a" undoes once as "abc".
   */
  pushBackspaceDeleted(char: string): void {
    const normalized = normalizeTextForShellReinsert(char);
    if (!normalized) {
      return;
    }
    if (this.coalesceBackspace && this.undoStack.length > 0) {
      // Prepend: most recently deleted char is left of earlier-deleted chars
      // when re-typed (cursor was walking left).
      const last = this.undoStack[this.undoStack.length - 1] ?? "";
      this.undoStack[this.undoStack.length - 1] = normalized + last;
      this.redoStack = [];
      return;
    }
    this.pushUndoEntry(normalized);
    this.coalesceBackspace = true;
  }

  /**
   * Pop the most recent deleted string for re-insert. Moves it onto the redo stack.
   * Returns null when there is nothing to undo.
   */
  undo(): string | null {
    this.coalesceBackspace = false;
    const text = this.undoStack.pop();
    if (text === undefined) {
      return null;
    }
    this.redoStack.push(text);
    while (this.redoStack.length > this.maxEntries) {
      this.redoStack.shift();
    }
    return text;
  }

  /**
   * Pop the most recent undone string so it can be deleted again.
   * Returns null when there is nothing to redo.
   */
  redo(): string | null {
    this.coalesceBackspace = false;
    const text = this.redoStack.pop();
    if (text === undefined) {
      return null;
    }
    this.undoStack.push(text);
    while (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    return text;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.coalesceBackspace = false;
  }

  private pushUndoEntry(text: string): void {
    const normalized = normalizeTextForShellReinsert(text);
    if (!normalized) {
      return;
    }
    this.undoStack.push(normalized);
    while (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }
}

/**
 * Detect text-field undo/redo chords.
 * - macOS: ⌘Z undo, ⌘⇧Z redo
 * - others: Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo
 *
 * When the matching stack is empty we still report the chord so the caller can
 * swallow it (avoid SIGTSTP on Ctrl+Z after an undo emptied the stack mid-session
 * only when we *own* the chord — caller decides).
 */
export function resolveEditHistoryChord(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isMac: boolean;
}): "undo" | "redo" | null {
  if (input.altKey) {
    return null;
  }
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (key !== "z" && key !== "y" && key !== "Z" && key !== "Y") {
    // key may already be lowercased from toLowerCase on length-1 only
  }
  const letter = input.key.toLowerCase();

  if (input.isMac) {
    if (!input.metaKey || input.ctrlKey) {
      return null;
    }
    if (letter === "z") {
      return input.shiftKey ? "redo" : "undo";
    }
    return null;
  }

  // Non-Mac: Ctrl without Meta
  if (!input.ctrlKey || input.metaKey) {
    return null;
  }
  if (letter === "z") {
    return input.shiftKey ? "redo" : "undo";
  }
  if (letter === "y" && !input.shiftKey) {
    return "redo";
  }
  return null;
}
