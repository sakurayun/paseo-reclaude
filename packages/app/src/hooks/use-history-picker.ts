import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { mergePromptHistorySources } from "@/hooks/use-prompt-history";
import { useGlobalPromptHistoryStore } from "@/stores/prompt-history-store";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { isCursorOnFirstLine } from "@/utils/cursor-line-position";

const EMPTY_STREAM: readonly StreamItem[] = [];

export interface UseHistoryPickerArgs {
  /** Current value of the input. */
  value: string;
  /** Cursor position (collapsed selection start). */
  cursorIndex: number;
  /** Active agent — drives per-agent history priority. */
  agentId: string;
  /** Active server — drives per-agent history priority. */
  serverId: string;
  /** Called to replace the input with a chosen history entry. */
  onApply: (text: string) => void;
}

export interface UseHistoryPickerResult {
  /** Whether the picker overlay should be shown. */
  isVisible: boolean;
  /** History entries as options, oldest-first (newest at the bottom). */
  options: readonly AutocompleteOption[];
  /** Highlighted option index, or -1 when closed. */
  selectedIndex: number;
  /**
   * Key handler following the autocomplete contract: returns `true` when the
   * event was consumed (caller must NOT run default behavior), `false` to let
   * default behavior happen.
   *
   * Closed: `ArrowUp` opens the picker when the cursor is on the first line and
   * history is non-empty, highlighting the newest entry. Open: `ArrowUp`/
   * `ArrowDown` move the highlight (ArrowUp stops at the oldest); `Enter`/`Tab`
   * apply the highlighted entry; `Escape` closes; pressing `ArrowDown` while on
   * the newest entry closes the picker; any other key closes it and passes
   * through (so the user can keep typing).
   */
  onKeyPress: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Apply an entry — used by mouse clicks on a row. */
  onSelectOption: (option: AutocompleteOption) => void;
  /** Close the picker. Call after submit / on blur. */
  reset: () => void;
}

interface HistoryPickerRefState {
  entries: string[];
  value: string;
  cursorIndex: number;
  onApply: (text: string) => void;
}

export function useHistoryPicker(args: UseHistoryPickerArgs): UseHistoryPickerResult {
  const { value, cursorIndex, agentId, serverId, onApply } = args;

  const localTail = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail.get(agentId) ?? EMPTY_STREAM,
  );
  const localHead = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamHead.get(agentId) ?? EMPTY_STREAM,
  );
  const globalEntries = useGlobalPromptHistoryStore((state) => state.entries);

  // Oldest-first: index 0 is the oldest, the last entry is the newest. The
  // popover pins to the bottom, so the newest entry sits closest to the input.
  const entries = useMemo(
    () => mergePromptHistorySources({ localTail, localHead, globalEntries }),
    [localTail, localHead, globalEntries],
  );

  const options = useMemo<AutocompleteOption[]>(
    () => entries.map((text, index) => ({ id: `history-${index}`, label: text })),
    [entries],
  );

  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Render-time ref sync (same pattern usePromptHistory uses) so the values the
  // key handler reads stay fresh without re-subscribing the handler each keystroke.
  const stateRef = useRef<HistoryPickerRefState>({ entries, value, cursorIndex, onApply });
  stateRef.current = { entries, value, cursorIndex, onApply };

  // If the history list shrinks while open, keep the highlight in range.
  useEffect(() => {
    if (!open) return;
    if (selectedIndex > entries.length - 1) {
      setSelectedIndex(Math.max(0, entries.length - 1));
    }
  }, [open, entries.length, selectedIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setSelectedIndex(-1);
  }, []);

  const onSelectOption = useCallback(
    (option: AutocompleteOption) => {
      stateRef.current.onApply(option.label);
      close();
    },
    [close],
  );

  const onKeyPress = useCallback(
    (event: { key: string; preventDefault: () => void }): boolean => {
      const {
        entries: live,
        value: liveValue,
        cursorIndex: liveCursor,
        onApply: liveApply,
      } = stateRef.current;

      if (!open) {
        // Open only on ArrowUp, cursor on the first line, with history available.
        if (event.key !== "ArrowUp") return false;
        if (!isCursorOnFirstLine(liveValue, liveCursor)) return false;
        if (live.length === 0) return false;
        event.preventDefault();
        setOpen(true);
        setSelectedIndex(live.length - 1); // newest (last) entry
        return true;
      }

      switch (event.key) {
        case "ArrowUp":
          // Walk toward older entries; stop at the oldest.
          event.preventDefault();
          setSelectedIndex((current) => (current > 0 ? current - 1 : 0));
          return true;
        case "ArrowDown":
          event.preventDefault();
          if (selectedIndex >= live.length - 1) {
            // Already on the newest entry — pressing down again closes the picker.
            close();
            return true;
          }
          setSelectedIndex(selectedIndex + 1);
          return true;
        case "Enter":
        case "Tab": {
          event.preventDefault();
          const text = live[selectedIndex];
          if (text !== undefined) liveApply(text);
          close();
          return true;
        }
        case "Escape":
          event.preventDefault();
          close();
          return true;
        default:
          // Any other key (typing, etc.) dismisses the picker and passes through.
          close();
          return false;
      }
    },
    [open, selectedIndex, close],
  );

  return {
    isVisible: open && options.length > 0,
    options,
    selectedIndex,
    onKeyPress,
    onSelectOption,
    reset: close,
  };
}
