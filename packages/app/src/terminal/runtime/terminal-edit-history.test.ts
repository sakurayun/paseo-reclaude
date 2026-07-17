import { describe, expect, it } from "vitest";
import {
  buildRedoDeleteSequence,
  isEditHistoryBreakingInput,
  normalizeTextForShellReinsert,
  resolveEditHistoryChord,
  TerminalEditHistory,
} from "./terminal-edit-history";

describe("normalizeTextForShellReinsert", () => {
  it("strips newlines and normalizes nbsp", () => {
    expect(normalizeTextForShellReinsert("a\nb\r\nc")).toBe("abc");
    expect(normalizeTextForShellReinsert("x\u00a0y")).toBe("x y");
    expect(normalizeTextForShellReinsert("")).toBe("");
  });
});

describe("buildRedoDeleteSequence", () => {
  it("emits one backspace per editor character", () => {
    expect(buildRedoDeleteSequence("ab")).toBe("\x7f\x7f");
    expect(buildRedoDeleteSequence("中")).toBe("\x7f");
    expect(buildRedoDeleteSequence("")).toBe("");
  });
});

describe("isEditHistoryBreakingInput", () => {
  it("treats plain backspace/delete as non-breaking", () => {
    expect(isEditHistoryBreakingInput("\x7f")).toBe(false);
    expect(isEditHistoryBreakingInput("\x08")).toBe(false);
    expect(isEditHistoryBreakingInput("\x1b[3~")).toBe(false);
  });

  it("treats typing, enter, and arrows as breaking", () => {
    expect(isEditHistoryBreakingInput("a")).toBe(true);
    expect(isEditHistoryBreakingInput("中")).toBe(true);
    expect(isEditHistoryBreakingInput("\r")).toBe(true);
    expect(isEditHistoryBreakingInput("\x1b[D")).toBe(true);
  });
});

describe("TerminalEditHistory", () => {
  it("undoes and redoes deleted text in LIFO order", () => {
    const history = new TerminalEditHistory();
    history.pushDeleted("one");
    history.pushDeleted("two");

    expect(history.canUndo).toBe(true);
    expect(history.undo()).toBe("two");
    expect(history.undo()).toBe("one");
    expect(history.undo()).toBeNull();
    expect(history.canUndo).toBe(false);

    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe("one");
    expect(history.redo()).toBe("two");
    expect(history.redo()).toBeNull();
  });

  it("coalesces consecutive plain backspaces into one undo entry", () => {
    const history = new TerminalEditHistory();
    // User had "abc|", deleted c then b then a
    history.pushBackspaceDeleted("c");
    history.pushBackspaceDeleted("b");
    history.pushBackspaceDeleted("a");
    expect(history.undo()).toBe("abc");
    expect(history.undo()).toBeNull();
  });

  it("starts a new entry after selection-delete then backspace", () => {
    const history = new TerminalEditHistory();
    history.pushDeleted("word");
    history.pushBackspaceDeleted("x");
    expect(history.undo()).toBe("x");
    expect(history.undo()).toBe("word");
  });

  it("clears redo when a new delete is pushed", () => {
    const history = new TerminalEditHistory();
    history.pushDeleted("a");
    history.undo();
    expect(history.canRedo).toBe(true);
    history.pushDeleted("b");
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe("b");
  });

  it("ignores empty deletes", () => {
    const history = new TerminalEditHistory();
    history.pushDeleted("");
    history.pushDeleted("\n\n");
    history.pushBackspaceDeleted("");
    expect(history.canUndo).toBe(false);
  });

  it("caps stack depth", () => {
    const history = new TerminalEditHistory(2);
    history.pushDeleted("a");
    history.pushDeleted("b");
    history.pushDeleted("c");
    expect(history.undo()).toBe("c");
    expect(history.undo()).toBe("b");
    expect(history.undo()).toBeNull();
  });

  it("clear wipes both stacks", () => {
    const history = new TerminalEditHistory();
    history.pushDeleted("a");
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe("resolveEditHistoryChord", () => {
  it("maps macOS chords", () => {
    expect(
      resolveEditHistoryChord({
        key: "z",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        isMac: true,
      }),
    ).toBe("undo");
    expect(
      resolveEditHistoryChord({
        key: "z",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        isMac: true,
      }),
    ).toBe("redo");
  });

  it("maps non-mac chords", () => {
    expect(
      resolveEditHistoryChord({
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isMac: false,
      }),
    ).toBe("undo");
    expect(
      resolveEditHistoryChord({
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        isMac: false,
      }),
    ).toBe("redo");
    expect(
      resolveEditHistoryChord({
        key: "y",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isMac: false,
      }),
    ).toBe("redo");
  });

  it("ignores unrelated keys", () => {
    expect(
      resolveEditHistoryChord({
        key: "z",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isMac: false,
      }),
    ).toBeNull();
    expect(
      resolveEditHistoryChord({
        key: "a",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isMac: false,
      }),
    ).toBeNull();
  });
});
