import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { mergePromptHistorySources } from "@/hooks/use-prompt-history";
import { useGlobalPromptHistoryStore } from "@/stores/prompt-history-store";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { isCursorOnFirstLine } from "@/utils/cursor-line-position";

const EMPTY_STREAM: readonly StreamItem[] = [];
const EMPTY_PRESETS: readonly string[] = [];

export interface UseHistoryPickerArgs {
  /** Current value of the input. */
  value: string;
  /** Cursor position (collapsed selection start). */
  cursorIndex: number;
  /** Active agent — drives per-agent history priority. */
  agentId: string;
  /** Active server — drives per-agent history priority. */
  serverId: string;
  /** Called to replace the input with a chosen history (or preset) entry. */
  onApply: (text: string) => void;
  /**
   * Preset messages reachable by pressing `ArrowRight` while the history list
   * is open (and left again with `ArrowLeft`). Oldest-first, newest at the
   * bottom, matching the history ordering.
   */
  presets?: readonly string[];
}

/** Which list the open picker is currently showing. */
export type HistoryPickerMode = "history" | "presets";

export interface UseHistoryPickerResult {
  /** Whether the picker overlay should be shown. */
  isVisible: boolean;
  /** Which list is currently shown (only meaningful while `isVisible`). */
  mode: HistoryPickerMode;
  /**
   * Whether the other list is reachable right now — ArrowRight has presets to
   * jump to (history mode), or ArrowLeft has history to return to (presets
   * mode). Drives the "switch" hint in the track header.
   */
  canSwitch: boolean;
  /** Active list entries as options, oldest-first (newest at the bottom). */
  options: readonly AutocompleteOption[];
  /** Highlighted option index, or -1 when closed. */
  selectedIndex: number;
  /**
   * Key handler following the autocomplete contract: returns `true` when the
   * event was consumed (caller must NOT run default behavior), `false` to let
   * default behavior happen.
   *
   * Closed: `ArrowUp` opens the history list when the cursor is on the first
   * line and history is non-empty, highlighting the newest entry. Open:
   * `ArrowUp`/`ArrowDown` move the highlight (ArrowUp stops at the oldest);
   * `ArrowRight` from the history list switches to the presets list (when any),
   * restarting from the bottom; `ArrowLeft` from the presets list switches back
   * to the history list, restarting from the bottom; `Enter`/`Tab` apply the
   * highlighted entry; `Escape` closes; pressing `ArrowDown` while on the newest
   * entry closes the picker; any other key closes it and passes through (so the
   * user can keep typing).
   */
  onKeyPress: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Apply an entry — used by mouse clicks on a row. */
  onSelectOption: (option: AutocompleteOption) => void;
  /** Close the picker. Call after submit / on blur. */
  reset: () => void;
}

interface HistoryPickerRefState {
  historyEntries: string[];
  presetEntries: readonly string[];
  value: string;
  cursorIndex: number;
  onApply: (text: string) => void;
}

export function useHistoryPicker(args: UseHistoryPickerArgs): UseHistoryPickerResult {
  const { value, cursorIndex, agentId, serverId, onApply, presets } = args;
  const presetEntries = presets ?? EMPTY_PRESETS;

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

  const historyOptions = useMemo<AutocompleteOption[]>(
    () => entries.map((text, index) => ({ id: `history-${index}`, label: text })),
    [entries],
  );
  const presetOptions = useMemo<AutocompleteOption[]>(
    () => presetEntries.map((text, index) => ({ id: `preset-${index}`, label: text })),
    [presetEntries],
  );

  // "closed" hides the picker; otherwise the value names the active list.
  const [mode, setMode] = useState<HistoryPickerMode | "closed">("closed");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const activeEntries = mode === "presets" ? presetEntries : entries;
  const activeOptions = mode === "presets" ? presetOptions : historyOptions;

  // Render-time ref sync (same pattern usePromptHistory uses) so the values the
  // key handler reads stay fresh without re-subscribing the handler each keystroke.
  const stateRef = useRef<HistoryPickerRefState>({
    historyEntries: entries,
    presetEntries,
    value,
    cursorIndex,
    onApply,
  });
  stateRef.current = { historyEntries: entries, presetEntries, value, cursorIndex, onApply };

  // If the active list shrinks while open, keep the highlight in range.
  useEffect(() => {
    if (mode === "closed") return;
    if (selectedIndex > activeEntries.length - 1) {
      setSelectedIndex(Math.max(0, activeEntries.length - 1));
    }
  }, [mode, activeEntries.length, selectedIndex]);

  const close = useCallback(() => {
    setMode("closed");
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
        historyEntries,
        presetEntries: livePresets,
        value: liveValue,
        cursorIndex: liveCursor,
        onApply: liveApply,
      } = stateRef.current;

      if (mode === "closed") {
        // Open only on ArrowUp, cursor on the first line, with history available.
        if (event.key !== "ArrowUp") return false;
        if (!isCursorOnFirstLine(liveValue, liveCursor)) return false;
        if (historyEntries.length === 0) return false;
        event.preventDefault();
        setMode("history");
        setSelectedIndex(historyEntries.length - 1); // newest (last) entry
        return true;
      }

      const live = mode === "presets" ? livePresets : historyEntries;

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
        case "ArrowRight":
          // From history, hop into the presets list and restart from the bottom
          // (newest, closest to the input). No presets → dismiss + pass through.
          if (mode === "history" && livePresets.length > 0) {
            event.preventDefault();
            setMode("presets");
            setSelectedIndex(livePresets.length - 1);
            return true;
          }
          close();
          return false;
        case "ArrowLeft":
          // From presets, hop back to the history list, restarting from the bottom.
          if (mode === "presets" && historyEntries.length > 0) {
            event.preventDefault();
            setMode("history");
            setSelectedIndex(historyEntries.length - 1);
            return true;
          }
          close();
          return false;
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
    [mode, selectedIndex, close],
  );

  return {
    isVisible: mode !== "closed" && activeOptions.length > 0,
    mode: mode === "presets" ? "presets" : "history",
    canSwitch: mode === "presets" ? entries.length > 0 : presetEntries.length > 0,
    options: activeOptions,
    selectedIndex,
    onKeyPress,
    onSelectOption,
    reset: close,
  };
}
