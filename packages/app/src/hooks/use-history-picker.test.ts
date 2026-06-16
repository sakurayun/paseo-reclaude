/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import {
  useHistoryPicker,
  type UseHistoryPickerArgs,
  type UseHistoryPickerResult,
} from "@/hooks/use-history-picker";
import { useGlobalPromptHistoryStore } from "@/stores/prompt-history-store";
import { useSessionStore } from "@/stores/session-store";

const SERVER_ID = "server-1";
const AGENT_ID = "agent-1";

function resetStores(): void {
  useGlobalPromptHistoryStore.setState({ entries: [] });
  useSessionStore.setState({ sessions: {} } as Partial<
    ReturnType<typeof useSessionStore.getState>
  >);
}

function seedGlobalHistory(entries: string[]): void {
  // entries are oldest-first (newest last), matching the store's ordering.
  useGlobalPromptHistoryStore.setState({ entries });
}

function makeEvent(key: string) {
  return { key, preventDefault: vi.fn<() => void>() };
}

interface HostState {
  value: string;
  cursorIndex: number;
}

function renderHistoryPicker(initial: HostState) {
  const onApply = vi.fn();
  const state = { ...initial };
  const hook = renderHook<
    UseHistoryPickerResult,
    Pick<UseHistoryPickerArgs, "value" | "cursorIndex">
  >(
    ({ value, cursorIndex }) =>
      useHistoryPicker({ value, cursorIndex, agentId: AGENT_ID, serverId: SERVER_ID, onApply }),
    { initialProps: state },
  );
  return { onApply, result: hook.result };
}

describe("useHistoryPicker", () => {
  beforeEach(() => {
    resetStores();
  });

  it("ArrowUp on the first line opens the picker, highlighting the newest entry", () => {
    seedGlobalHistory(["old", "mid", "new"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    expect(result.current.isVisible).toBe(false);

    let handled = false;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("ArrowUp"));
    });

    expect(handled).toBe(true);
    expect(result.current.isVisible).toBe(true);
    expect(result.current.selectedIndex).toBe(2); // newest = last entry
    expect(result.current.options.map((o) => o.label)).toEqual(["old", "mid", "new"]);
  });

  it("ArrowUp does not open when the cursor is not on the first line", () => {
    seedGlobalHistory(["a", "b"]);
    // "line1\nline2" — cursor index 8 sits on the second line.
    const { result } = renderHistoryPicker({ value: "line1\nline2", cursorIndex: 8 });

    let handled = true;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("ArrowUp"));
    });

    expect(handled).toBe(false);
    expect(result.current.isVisible).toBe(false);
  });

  it("ArrowUp does not open when history is empty", () => {
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    let handled = true;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("ArrowUp"));
    });

    expect(handled).toBe(false);
    expect(result.current.isVisible).toBe(false);
  });

  it("ArrowUp while open walks to older entries and stops at the oldest", () => {
    seedGlobalHistory(["old", "mid", "new"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // open, index 2
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 1
    expect(result.current.selectedIndex).toBe(1);
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 0 (oldest)
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // stays at 0
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.isVisible).toBe(true);
  });

  it("ArrowDown walks back toward newer entries", () => {
    seedGlobalHistory(["old", "mid", "new"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 2
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 1
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 0
    act(() => result.current.onKeyPress(makeEvent("ArrowDown"))); // index 1
    expect(result.current.selectedIndex).toBe(1);
  });

  it("ArrowDown on the newest entry closes the picker", () => {
    seedGlobalHistory(["old", "new"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // open, index 1 (newest)
    expect(result.current.selectedIndex).toBe(1);

    let handled = false;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("ArrowDown")); // close
    });

    expect(handled).toBe(true);
    expect(result.current.isVisible).toBe(false);
    expect(result.current.selectedIndex).toBe(-1);
  });

  it("Enter applies the highlighted entry and closes", () => {
    seedGlobalHistory(["old", "mid", "new"]);
    const { result, onApply } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 2 (new)
    act(() => result.current.onKeyPress(makeEvent("ArrowUp"))); // index 1 (mid)

    let handled = false;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("Enter"));
    });

    expect(handled).toBe(true);
    expect(onApply).toHaveBeenCalledWith("mid");
    expect(result.current.isVisible).toBe(false);
  });

  it("Escape closes without applying", () => {
    seedGlobalHistory(["a", "b"]);
    const { result, onApply } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp")));
    act(() => result.current.onKeyPress(makeEvent("Escape")));

    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.isVisible).toBe(false);
  });

  it("typing closes the picker and passes the key through", () => {
    seedGlobalHistory(["a", "b"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp")));
    expect(result.current.isVisible).toBe(true);

    let handled = true;
    act(() => {
      handled = result.current.onKeyPress(makeEvent("a"));
    });

    expect(handled).toBe(false);
    expect(result.current.isVisible).toBe(false);
  });

  it("onSelectOption (mouse click) applies the entry and closes", () => {
    seedGlobalHistory(["a", "b"]);
    const { result, onApply } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp")));
    act(() => result.current.onSelectOption({ id: "history-0", label: "a" }));

    expect(onApply).toHaveBeenCalledWith("a");
    expect(result.current.isVisible).toBe(false);
  });

  it("reset closes the picker", () => {
    seedGlobalHistory(["a", "b"]);
    const { result } = renderHistoryPicker({ value: "", cursorIndex: 0 });

    act(() => result.current.onKeyPress(makeEvent("ArrowUp")));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.reset());
    expect(result.current.isVisible).toBe(false);
  });
});
