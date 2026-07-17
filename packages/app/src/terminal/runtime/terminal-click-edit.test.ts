import { describe, expect, it } from "vitest";
import {
  arrowSequence,
  buildDeleteSelectionSequence,
  buildMoveCursorToViewportCellSequence,
  countCharactersBetweenBufferPositions,
  countCharactersInCell,
  countCharactersInSelectionRange,
  countEditorCharacters,
  countSelectionDeleteUnits,
  isSelectionOnCursorWrappedLine,
  isViewportCellOnCursorWrappedLine,
  linearCellOffset,
  resolveSelectionDeleteCount,
  resolveTerminalViewportCellFromMouse,
  resolveWrappedLineRange,
  shouldMoveCursorOnClick,
  resolveCharacterBeforeCursor,
  snapPlacementColumnToCharacterBoundary,
  snapSelectionEndExclusiveToGlyph,
  snapSelectionStartToGlyph,
  type TerminalBufferCellContent,
  type TerminalBufferCellLookup,
} from "./terminal-click-edit";

/**
 * Build a single-line cell lookup from a string of cells.
 * Wide glyphs: pass `{ chars: "中", width: 2 }` and the next cell is auto-filled as width 0.
 */
function lineLookup(
  cells: Array<string | TerminalBufferCellContent>,
  absoluteY = 0,
): TerminalBufferCellLookup {
  const expanded: TerminalBufferCellContent[] = [];
  for (const entry of cells) {
    if (typeof entry === "string") {
      expanded.push({ chars: entry, width: 1 });
      continue;
    }
    expanded.push(entry);
    if (entry.width === 2) {
      expanded.push({ chars: "", width: 0 });
    }
  }
  return (y, x) => {
    if (y !== absoluteY) {
      return null;
    }
    return expanded[x] ?? { chars: "", width: 1 };
  };
}

describe("resolveTerminalViewportCellFromMouse", () => {
  it("maps the top-left pixel into cell 0,0", () => {
    expect(
      resolveTerminalViewportCellFromMouse({
        clientX: 10,
        clientY: 20,
        screenLeft: 10,
        screenTop: 20,
        cellWidth: 8,
        cellHeight: 16,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ col: 0, row: 0 });
  });

  it("maps into the cell under the pointer", () => {
    expect(
      resolveTerminalViewportCellFromMouse({
        clientX: 10 + 8 * 5 + 1,
        clientY: 20 + 16 * 3 + 1,
        screenLeft: 10,
        screenTop: 20,
        cellWidth: 8,
        cellHeight: 16,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ col: 5, row: 3 });
  });

  it("returns null when cell metrics are invalid", () => {
    expect(
      resolveTerminalViewportCellFromMouse({
        clientX: 0,
        clientY: 0,
        screenLeft: 0,
        screenTop: 0,
        cellWidth: 0,
        cellHeight: 16,
        cols: 80,
        rows: 24,
      }),
    ).toBeNull();
  });
});

describe("countCharactersInCell / countEditorCharacters", () => {
  it("skips wide-glyph continuations and empty pads", () => {
    expect(countCharactersInCell(null)).toBe(0);
    expect(countCharactersInCell({ width: 0, chars: "" })).toBe(0);
    expect(countCharactersInCell({ width: 1, chars: "" })).toBe(0);
    expect(countCharactersInCell({ width: 1, chars: "a" })).toBe(1);
    expect(countCharactersInCell({ width: 2, chars: "中" })).toBe(1);
    expect(countCharactersInCell({ width: 1, chars: "👍" })).toBe(1);
  });

  it("counts graphemes when Segmenter is available", () => {
    expect(countEditorCharacters("hello")).toBe(5);
    expect(countEditorCharacters("a\nb")).toBe(2);
    expect(countEditorCharacters("你")).toBe(1);
    expect(countEditorCharacters("")).toBe(0);
  });
});

describe("countCharactersBetweenBufferPositions", () => {
  // Layout: "a中b，c" → cells: a | 中 | (0) | b | ， | (0) | c
  const mixed = lineLookup(["a", { chars: "中", width: 2 }, "b", { chars: "，", width: 2 }, "c"]);

  it("counts mixed CJK/ASCII/fullwidth as characters not cells", () => {
    expect(
      countCharactersBetweenBufferPositions({
        from: { x: 0, y: 0 },
        to: { x: 7, y: 0 },
        cols: 80,
        getCell: mixed,
      }),
    ).toBe(5);
  });

  it("returns a signed distance for reverse walks", () => {
    expect(
      countCharactersBetweenBufferPositions({
        from: { x: 7, y: 0 },
        to: { x: 1, y: 0 },
        cols: 80,
        getCell: mixed,
      }),
    ).toBe(-4);
  });

  it("does not count empty padding beyond the text", () => {
    expect(
      countCharactersBetweenBufferPositions({
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        cols: 80,
        getCell: mixed,
      }),
    ).toBe(5);
  });
});

describe("glyph boundary snaps", () => {
  const mixed = lineLookup(["a", { chars: "中", width: 2 }, "b"]);

  it("snaps placement off the trailing half of a wide glyph", () => {
    expect(
      snapPlacementColumnToCharacterBoundary({
        col: 2,
        absoluteY: 0,
        cols: 80,
        getCell: mixed,
      }),
    ).toBe(3);
  });

  it("snaps selection start back onto the wide-glyph head", () => {
    expect(
      snapSelectionStartToGlyph({
        position: { x: 2, y: 0 },
        getCell: mixed,
      }),
    ).toEqual({ x: 1, y: 0 });
  });

  it("snaps exclusive selection end past a wide-glyph continuation", () => {
    expect(
      snapSelectionEndExclusiveToGlyph({
        position: { x: 2, y: 0 },
        cols: 80,
        getCell: mixed,
      }),
    ).toEqual({ x: 3, y: 0 });
  });
});

describe("buildMoveCursorToViewportCellSequence", () => {
  // "xy中文z！ab" cells: x y 中 cont 文 cont z ！ cont a b
  const mixed = lineLookup([
    "x",
    "y",
    { chars: "中", width: 2 },
    { chars: "文", width: 2 },
    "z",
    { chars: "！", width: 2 },
    "a",
    "b",
  ]);

  it("emits character-count arrows for mixed-width text (not cell count)", () => {
    // Cursor after "b" (col 11) → start of "中" (col 2):
    // chars crossed: 中 文 z ！ a b = 6  (cells would be 9)
    expect(
      buildMoveCursorToViewportCellSequence({
        targetCol: 2,
        targetRow: 0,
        cursorCol: 11,
        cursorRow: 0,
        cols: 80,
        applicationCursorKeys: false,
        horizontalOnly: true,
        baseY: 0,
        getCell: mixed,
      }),
    ).toBe("\x1b[D".repeat(6));
  });

  it("emits right arrows for a forward same-row move (ASCII)", () => {
    const ascii = lineLookup(["h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d"]);
    expect(
      buildMoveCursorToViewportCellSequence({
        targetCol: 10,
        targetRow: 0,
        cursorCol: 3,
        cursorRow: 0,
        cols: 80,
        applicationCursorKeys: false,
        horizontalOnly: true,
        baseY: 0,
        getCell: ascii,
      }),
    ).toBe("\x1b[C".repeat(7));
  });

  it("uses application cursor keys when enabled", () => {
    const ascii = lineLookup(["a", "b", "c", "d", "e"]);
    expect(
      buildMoveCursorToViewportCellSequence({
        targetCol: 4,
        targetRow: 0,
        cursorCol: 2,
        cursorRow: 0,
        cols: 80,
        applicationCursorKeys: true,
        horizontalOnly: true,
        baseY: 0,
        getCell: ascii,
      }),
    ).toBe("\x1bOC".repeat(2));
  });

  it("falls back to cell distance without a cell lookup", () => {
    expect(
      buildMoveCursorToViewportCellSequence({
        targetCol: 10,
        targetRow: 5,
        cursorCol: 3,
        cursorRow: 5,
        cols: 80,
        applicationCursorKeys: false,
        horizontalOnly: true,
      }),
    ).toBe("\x1b[C".repeat(7));
  });

  it("returns empty when already at the target", () => {
    expect(
      buildMoveCursorToViewportCellSequence({
        targetCol: 5,
        targetRow: 5,
        cursorCol: 5,
        cursorRow: 5,
        cols: 80,
        applicationCursorKeys: false,
        horizontalOnly: true,
        getCell: lineLookup([]),
      }),
    ).toBe("");
  });
});

describe("linearCellOffset", () => {
  it("computes wrapped offsets", () => {
    expect(linearCellOffset({ col: 10, row: 0 }, { col: 5, row: 1 }, 80)).toBe(75);
    expect(linearCellOffset({ col: 5, row: 1 }, { col: 10, row: 0 }, 80)).toBe(-75);
  });
});

describe("countSelectionDeleteUnits", () => {
  it("delegates to editor character counting", () => {
    expect(countSelectionDeleteUnits("hello")).toBe(5);
    expect(countSelectionDeleteUnits("你")).toBe(1);
  });
});

describe("countCharactersInSelectionRange / resolveSelectionDeleteCount", () => {
  it("counts mixed-width selection by character via cell walk", () => {
    const getCell = lineLookup(["a", { chars: "中", width: 2 }, "b"]);
    expect(
      countCharactersInSelectionRange({
        start: { x: 0, y: 0 },
        end: { x: 4, y: 0 },
        cols: 80,
        getCell,
      }),
    ).toBe(3);
    expect(
      countCharactersInSelectionRange({
        start: { x: 1, y: 0 },
        end: { x: 3, y: 0 },
        cols: 80,
        getCell,
      }),
    ).toBe(1);
  });

  it("prefers buffer walk over selection text when both are available", () => {
    const getCell = lineLookup(["a", { chars: "中", width: 2 }, "b"]);
    // Text claims 99 chars but buffer only has 1 for 中
    expect(
      resolveSelectionDeleteCount({
        selectionText: "x".repeat(99),
        start: { x: 1, y: 0 },
        end: { x: 3, y: 0 },
        cols: 80,
        getCell,
      }),
    ).toBe(1);
  });

  it("falls back to selection text when buffer walk is empty", () => {
    expect(
      resolveSelectionDeleteCount({
        selectionText: "ab",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        cols: 80,
      }),
    ).toBe(2);
  });
});

describe("wrapped line helpers", () => {
  it("expands a wrapped line range around the cursor", () => {
    const wrapped = new Set([2, 3]);
    expect(
      resolveWrappedLineRange({
        absoluteY: 2,
        isLineWrapped: (y) => wrapped.has(y),
        maxY: 10,
      }),
    ).toEqual({ first: 1, last: 3 });
  });

  it("detects selection on the cursor wrapped line", () => {
    const wrapped = new Set([5]);
    expect(
      isSelectionOnCursorWrappedLine({
        selectionStart: { x: 2, y: 4 },
        selectionEnd: { x: 10, y: 5 },
        cursorAbsY: 5,
        isLineWrapped: (y) => wrapped.has(y),
      }),
    ).toBe(true);
  });

  it("detects viewport clicks on the cursor wrapped line", () => {
    const wrapped = new Set([11]);
    expect(
      isViewportCellOnCursorWrappedLine({
        targetRow: 1,
        cursorRow: 0,
        baseY: 10,
        isLineWrapped: (y) => wrapped.has(y),
      }),
    ).toBe(true);
  });
});

describe("buildDeleteSelectionSequence", () => {
  it("moves by character then backspaces the character count for ASCII", () => {
    const ascii = lineLookup(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const sequence = buildDeleteSelectionSequence({
      selectionStart: { x: 3, y: 100 },
      selectionEnd: { x: 8, y: 100 },
      selectionText: "34567",
      cursorCol: 10,
      cursorRow: 5,
      baseY: 95,
      cols: 80,
      rows: 24,
      applicationCursorKeys: false,
      horizontalOnly: true,
      getCell: (y, x) => ascii(y - 100, x),
    });
    expect(sequence).toBe("\x1b[D".repeat(2) + "\x7f".repeat(5));
  });

  it("handles mixed CJK/ASCII/symbols without overshooting (Backspace)", () => {
    // "a中文b！c" cells: a | 中 | c0 | 文 | c0 | b | ！ | c0 | c
    // Select "中文b" = cols [1, 6) → 3 characters
    // Cursor at col 9. Move left past "！c" (2 chars) then DEL×3.
    const getCell = lineLookup([
      "a",
      { chars: "中", width: 2 },
      { chars: "文", width: 2 },
      "b",
      { chars: "！", width: 2 },
      "c",
    ]);
    const sequence = buildDeleteSelectionSequence({
      selectionStart: { x: 1, y: 0 },
      selectionEnd: { x: 6, y: 0 },
      selectionText: "中文b",
      cursorCol: 9,
      cursorRow: 0,
      baseY: 0,
      cols: 80,
      rows: 24,
      applicationCursorKeys: false,
      horizontalOnly: true,
      getCell,
      deleteKey: "Backspace",
    });
    expect(sequence).toBe("\x1b[D".repeat(2) + "\x7f".repeat(3));
  });

  it("moves to selection start and forward-deletes for the Delete key", () => {
    // Same layout; Delete moves to start of selection then CSI 3~
    const getCell = lineLookup([
      "a",
      { chars: "中", width: 2 },
      { chars: "文", width: 2 },
      "b",
      { chars: "！", width: 2 },
      "c",
    ]);
    // Select "中文b" [1,6), cursor at 9
    // Move to start col 1: left past 中文b！c = 5 chars
    const sequence = buildDeleteSelectionSequence({
      selectionStart: { x: 1, y: 0 },
      selectionEnd: { x: 6, y: 0 },
      selectionText: "中文b",
      cursorCol: 9,
      cursorRow: 0,
      baseY: 0,
      cols: 80,
      rows: 24,
      applicationCursorKeys: false,
      horizontalOnly: true,
      getCell,
      deleteKey: "Delete",
    });
    expect(sequence).toBe("\x1b[D".repeat(5) + "\x1b[3~".repeat(3));
  });

  it("uses buffer count even when selectionText is wrong/mismatched", () => {
    const getCell = lineLookup(["a", { chars: "中", width: 2 }, "b"]);
    // selectionText lies (says 10 chars) — buffer walk wins with 1 for 中
    const sequence = buildDeleteSelectionSequence({
      selectionStart: { x: 1, y: 0 },
      selectionEnd: { x: 3, y: 0 },
      selectionText: "xxxxxxxxxx",
      cursorCol: 4,
      cursorRow: 0,
      baseY: 0,
      cols: 80,
      rows: 24,
      applicationCursorKeys: false,
      horizontalOnly: true,
      getCell,
    });
    // from col 4 to col 3: left 1 (b), then 1 backspace
    expect(sequence).toBe("\x1b[D\x7f");
  });

  it("returns null when the selection range is empty", () => {
    expect(
      buildDeleteSelectionSequence({
        selectionStart: { x: 3, y: 1 },
        selectionEnd: { x: 3, y: 1 },
        selectionText: "",
        cursorCol: 3,
        cursorRow: 1,
        baseY: 0,
        cols: 80,
        rows: 24,
        applicationCursorKeys: false,
        horizontalOnly: true,
      }),
    ).toBeNull();
  });

  it("returns null when selection end is outside the viewport", () => {
    expect(
      buildDeleteSelectionSequence({
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: 5, y: 0 },
        selectionText: "hello",
        cursorCol: 5,
        cursorRow: 0,
        baseY: 10,
        cols: 80,
        rows: 24,
        applicationCursorKeys: false,
        horizontalOnly: true,
      }),
    ).toBeNull();
  });
});

describe("shouldMoveCursorOnClick", () => {
  const base = {
    button: 0,
    detail: 1,
    elapsedMs: 100,
    hasMeaningfulSelection: false,
    mouseTrackingMode: "none",
    scrolledToBottom: true,
    suppressInput: false,
  };

  it("accepts a plain short primary click at the bottom", () => {
    expect(shouldMoveCursorOnClick(base)).toBe(true);
  });

  it("rejects drag selections, multi-clicks, mouse apps, and scrolled views", () => {
    expect(shouldMoveCursorOnClick({ ...base, hasMeaningfulSelection: true })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, detail: 2 })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, mouseTrackingMode: "vt200" })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, scrolledToBottom: false })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, button: 2 })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, elapsedMs: 600 })).toBe(false);
    expect(shouldMoveCursorOnClick({ ...base, suppressInput: true })).toBe(false);
  });
});

describe("arrowSequence", () => {
  it("builds CSI and SS3 forms", () => {
    expect(arrowSequence("C", false)).toBe("\x1b[C");
    expect(arrowSequence("D", true)).toBe("\x1bOD");
  });
});

describe("resolveCharacterBeforeCursor", () => {
  it("returns the ASCII character left of the cursor", () => {
    const getCell = lineLookup(["h", "e", "l", "l", "o"]);
    expect(
      resolveCharacterBeforeCursor({
        cursorCol: 5,
        cursorRow: 0,
        baseY: 0,
        cols: 80,
        getCell,
        isLineWrapped: () => false,
      }),
    ).toBe("o");
  });

  it("returns a wide glyph when the cursor is just after it", () => {
    // "a中b" → a | 中 | cont | b ; cursor after 中 at col 3
    const getCell = lineLookup(["a", { chars: "中", width: 2 }, "b"]);
    expect(
      resolveCharacterBeforeCursor({
        cursorCol: 3,
        cursorRow: 0,
        baseY: 0,
        cols: 80,
        getCell,
        isLineWrapped: () => false,
      }),
    ).toBe("中");
  });

  it("walks onto the previous wrapped row", () => {
    // Row 0: ...x (at col 79), row 1 wrapped starts with y
    const cells0: Array<string | { chars: string; width: number }> = Array.from(
      { length: 80 },
      () => " ",
    );
    cells0[79] = "x";
    const getCell0 = lineLookup(cells0, 0);
    const getCell1 = lineLookup(["y"], 1);
    const getCell: TerminalBufferCellLookup = (y, x) => (y === 0 ? getCell0(y, x) : getCell1(y, x));

    expect(
      resolveCharacterBeforeCursor({
        cursorCol: 0,
        cursorRow: 1,
        baseY: 0,
        cols: 80,
        getCell,
        isLineWrapped: (y) => y === 1,
      }),
    ).toBe("x");
  });

  it("returns null at the start of an unwrapped line", () => {
    const getCell = lineLookup(["a", "b"]);
    expect(
      resolveCharacterBeforeCursor({
        cursorCol: 0,
        cursorRow: 0,
        baseY: 0,
        cols: 80,
        getCell,
        isLineWrapped: () => false,
      }),
    ).toBeNull();
  });
});
