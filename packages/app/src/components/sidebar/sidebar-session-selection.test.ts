import { describe, expect, it } from "vitest";
import {
  applySidebarSessionSelection,
  createEmptySidebarSessionSelection,
  parseSidebarSessionSelectionKey,
  readPointerSelectionMode,
  toSidebarSessionSelectionKey,
} from "./sidebar-session-selection";

const KEYS = ["a:1", "a:2", "a:3", "a:4", "a:5"] as const;

describe("sidebar session selection", () => {
  it("builds and parses session keys", () => {
    const key = toSidebarSessionSelectionKey({ serverId: "host", id: "agent-1" });
    expect(key).toBe("host:agent-1");
    expect(parseSidebarSessionSelectionKey(key)).toEqual({
      serverId: "host",
      agentId: "agent-1",
    });
    expect(parseSidebarSessionSelectionKey("bad")).toBeNull();
  });

  it("replaces selection on plain click", () => {
    const next = applySidebarSessionSelection({
      state: {
        selectedKeys: new Set(["a:1", "a:2"]),
        anchorKey: "a:1",
      },
      orderedKeys: KEYS,
      targetKey: "a:3",
      mode: "replace",
    });
    expect([...next.selectedKeys]).toEqual(["a:3"]);
    expect(next.anchorKey).toBe("a:3");
  });

  it("toggles selection with ctrl/cmd mode", () => {
    const first = applySidebarSessionSelection({
      state: createEmptySidebarSessionSelection(),
      orderedKeys: KEYS,
      targetKey: "a:1",
      mode: "toggle",
    });
    const second = applySidebarSessionSelection({
      state: first,
      orderedKeys: KEYS,
      targetKey: "a:3",
      mode: "toggle",
    });
    expect(new Set(second.selectedKeys)).toEqual(new Set(["a:1", "a:3"]));

    const third = applySidebarSessionSelection({
      state: second,
      orderedKeys: KEYS,
      targetKey: "a:1",
      mode: "toggle",
    });
    expect([...third.selectedKeys]).toEqual(["a:3"]);
  });

  it("selects the inclusive range between the anchor and the target", () => {
    const afterAnchor = applySidebarSessionSelection({
      state: createEmptySidebarSessionSelection(),
      orderedKeys: KEYS,
      targetKey: "a:2",
      mode: "toggle",
    });
    const ranged = applySidebarSessionSelection({
      state: afterAnchor,
      orderedKeys: KEYS,
      targetKey: "a:5",
      mode: "range",
    });
    expect(new Set(ranged.selectedKeys)).toEqual(new Set(["a:2", "a:3", "a:4", "a:5"]));
    expect(ranged.anchorKey).toBe("a:2");
  });

  it("falls back to a single selection when the range endpoints are missing", () => {
    const next = applySidebarSessionSelection({
      state: createEmptySidebarSessionSelection(),
      orderedKeys: KEYS,
      targetKey: "missing:1",
      mode: "range",
    });
    expect([...next.selectedKeys]).toEqual(["missing:1"]);
  });

  it("reads pointer modifiers from nativeEvent", () => {
    expect(readPointerSelectionMode({ nativeEvent: { ctrlKey: true } })).toBe("toggle");
    expect(readPointerSelectionMode({ nativeEvent: { metaKey: true } })).toBe("toggle");
    expect(readPointerSelectionMode({ nativeEvent: { shiftKey: true } })).toBe("range");
    expect(readPointerSelectionMode({ nativeEvent: { shiftKey: true, ctrlKey: true } })).toBe(
      "range",
    );
    expect(readPointerSelectionMode({})).toBe("replace");
  });
});
