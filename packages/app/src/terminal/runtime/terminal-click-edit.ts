/**
 * Click-to-position cursor and selection-backspace helpers for the terminal
 * emulator. These emulate text-field editing by sending shell line-editor
 * sequences (arrow keys / backspace).
 *
 * Shell line editors (readline/zsh/fish) move and delete by **character**
 * (typically grapheme clusters), not by terminal cell. Wide glyphs (CJK,
 * fullwidth punctuation, many emoji) occupy two cells but one cursor stop.
 *
 * Selection delete:
 *  - delete count ← graphemes in the selected text (what the user sees)
 *  - move distance ← graphemes between cursor and selection end, walked from
 *    buffer cells (skip width-0 halves and empty pad cells)
 * Both use the same grapheme counter so CJK/ASCII/symbol mixes stay aligned.
 *
 * Only meaningful when the shell is in line-edit mode and mouse tracking is off.
 */

const ESC = "\x1b";

export type TerminalArrowDirection = "A" | "B" | "C" | "D";

export interface TerminalViewportCell {
  /** 0-based column within the viewport. */
  col: number;
  /** 0-based row within the viewport. */
  row: number;
}

export interface TerminalBufferCell {
  /** 0-based column. */
  x: number;
  /** 0-based absolute buffer line. */
  y: number;
}

/** Minimal cell shape needed for wide-character-aware counting. */
export interface TerminalBufferCellContent {
  /** xterm cell width: 0 = right half of wide glyph, 1 = normal, 2 = wide. */
  width: number;
  /** Character(s) stored in this cell (empty for unused / trailing pad cells). */
  chars: string;
}

export type TerminalBufferCellLookup = (
  absoluteY: number,
  col: number,
) => TerminalBufferCellContent | null;

/** Line accessor used for selection-style string extraction. */
export interface TerminalBufferLineReader {
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string;
  isWrapped: boolean;
}

export type TerminalBufferLineLookup = (absoluteY: number) => TerminalBufferLineReader | null;

export function arrowSequence(
  direction: TerminalArrowDirection,
  applicationCursorKeys: boolean,
): string {
  return `${ESC}${applicationCursorKeys ? "O" : "["}${direction}`;
}

export function repeatSequence(count: number, sequence: string): string {
  const n = Math.floor(count);
  if (n <= 0 || sequence.length === 0) {
    return "";
  }
  return sequence.repeat(n);
}

/**
 * Map a mouse event to a 0-based viewport cell using xterm render dimensions.
 * Returns null when dimensions are unusable or the point is outside the grid.
 */
export function resolveTerminalViewportCellFromMouse(input: {
  clientX: number;
  clientY: number;
  screenLeft: number;
  screenTop: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  /** CSS padding on the screen element (xterm subtracts this before cell math). */
  paddingLeft?: number;
  paddingTop?: number;
  /** When true, snap to the boundary between cells (selection-style half-cell). */
  forSelection?: boolean;
}): TerminalViewportCell | null {
  const {
    clientX,
    clientY,
    screenLeft,
    screenTop,
    cellWidth,
    cellHeight,
    cols,
    rows,
    paddingLeft = 0,
    paddingTop = 0,
    forSelection = false,
  } = input;

  if (
    !Number.isFinite(cellWidth) ||
    !Number.isFinite(cellHeight) ||
    cellWidth <= 0 ||
    cellHeight <= 0 ||
    cols <= 0 ||
    rows <= 0
  ) {
    return null;
  }

  const relX = clientX - screenLeft - paddingLeft + (forSelection ? cellWidth / 2 : 0);
  const relY = clientY - screenTop - paddingTop;
  // Match xterm getCoords: ceil to 1-based, then convert to 0-based.
  const col1 = Math.ceil(relX / cellWidth);
  const row1 = Math.ceil(relY / cellHeight);
  const col = Math.min(Math.max(col1, 1), cols + (forSelection ? 1 : 0)) - 1;
  const row = Math.min(Math.max(row1, 1), rows) - 1;
  return { col, row };
}

/**
 * If the pointer landed on the trailing half of a wide glyph (width 0), snap
 * the placement column to just after that glyph so the shell cursor lands on a
 * real character boundary.
 */
export function snapPlacementColumnToCharacterBoundary(input: {
  col: number;
  absoluteY: number;
  cols: number;
  getCell: TerminalBufferCellLookup;
}): number {
  const { col, absoluteY, cols, getCell } = input;
  if (col < 0) {
    return 0;
  }
  if (col >= cols) {
    return cols;
  }
  const cell = getCell(absoluteY, col);
  // Trailing half of a wide character → place after the glyph.
  if (cell && cell.width === 0) {
    return Math.min(col + 1, cols);
  }
  return col;
}

/**
 * Snap an inclusive selection start onto the head cell of a wide glyph.
 */
export function snapSelectionStartToGlyph(input: {
  position: TerminalBufferCell;
  getCell: TerminalBufferCellLookup;
}): TerminalBufferCell {
  const { position, getCell } = input;
  let x = position.x;
  const y = position.y;
  while (x > 0 && getCell(y, x)?.width === 0) {
    x -= 1;
  }
  return { x, y };
}

/**
 * Snap an exclusive selection end so it never sits on a wide-glyph continuation
 * cell (width 0).
 */
export function snapSelectionEndExclusiveToGlyph(input: {
  position: TerminalBufferCell;
  cols: number;
  getCell: TerminalBufferCellLookup;
}): TerminalBufferCell {
  const { position, cols, getCell } = input;
  let x = position.x;
  const y = position.y;
  if (x < cols && getCell(y, x)?.width === 0) {
    x = Math.min(x + 1, cols);
  }
  return { x, y };
}

/**
 * Count line-editor units in a string. Prefers grapheme clusters (what zsh/fish
 * usually treat as one Backspace) and falls back to code points.
 */
export function countEditorCharacters(text: string): number {
  if (!text) {
    return 0;
  }
  // Strip CR/LF — wrapped visual lines have no real NL in the shell buffer.
  const withoutBreaks = text.replace(/\r\n/g, "").replace(/[\r\n]/g, "");
  if (!withoutBreaks) {
    return 0;
  }
  try {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      let count = 0;
      for (const _ of segmenter.segment(withoutBreaks)) {
        count += 1;
      }
      return count;
    }
  } catch {
    // Fall through to code-point counting.
  }
  return Array.from(withoutBreaks).length;
}

/**
 * How many shell line-editor characters live in this cell.
 * - width 0 (continuation): 0
 * - empty pad cell: 0
 * - otherwise: grapheme count of `chars`
 */
export function countCharactersInCell(cell: TerminalBufferCellContent | null): number {
  if (!cell || cell.width === 0) {
    return 0;
  }
  if (!cell.chars) {
    return 0;
  }
  return countEditorCharacters(cell.chars);
}

export function compareBufferCells(a: TerminalBufferCell, b: TerminalBufferCell): number {
  if (a.y !== b.y) {
    return a.y < b.y ? -1 : 1;
  }
  if (a.x === b.x) {
    return 0;
  }
  return a.x < b.x ? -1 : 1;
}

/**
 * Signed character distance from `from` to `to` along the buffer grid (wrapped
 * lines included). Positive = need RIGHT arrows; negative = LEFT.
 *
 * Walks every cell in `[from, to)` (or reverse). Skips wide-glyph continuations
 * and empty padding so the count matches the shell edit buffer, not display cells.
 */
export function countCharactersBetweenBufferPositions(input: {
  from: TerminalBufferCell;
  to: TerminalBufferCell;
  cols: number;
  getCell: TerminalBufferCellLookup;
}): number {
  const { from, to, cols, getCell } = input;
  if (cols <= 0) {
    return 0;
  }

  const order = compareBufferCells(from, to);
  if (order === 0) {
    return 0;
  }

  const forward = order < 0;
  const start = forward ? from : to;
  const end = forward ? to : from;
  let count = 0;
  let x = start.x;
  let y = start.y;

  // Hard cap avoids infinite loops on bad inputs.
  const maxSteps = Math.max(cols * 4, 1) * 256;
  let steps = 0;
  while (y < end.y || (y === end.y && x < end.x)) {
    if (steps++ > maxSteps) {
      break;
    }
    count += countCharactersInCell(getCell(y, x));
    x += 1;
    if (x >= cols) {
      x = 0;
      y += 1;
    }
  }

  return forward ? count : -count;
}

/**
 * Extract buffer text for `[start, end)` the same way xterm builds selection
 * text (join wrapped rows), without trimRight so interior spaces stay intact.
 */
export function extractBufferRangeText(input: {
  start: TerminalBufferCell;
  end: TerminalBufferCell;
  cols: number;
  getLine: TerminalBufferLineLookup;
}): string {
  const { start, end, cols, getLine } = input;
  if (cols <= 0 || compareBufferCells(start, end) >= 0) {
    return "";
  }

  const parts: string[] = [];

  if (start.y === end.y) {
    const line = getLine(start.y);
    if (!line) {
      return "";
    }
    return normalizeSelectionSpaces(line.translateToString(false, start.x, end.x));
  }

  const first = getLine(start.y);
  if (first) {
    parts.push(first.translateToString(false, start.x, cols));
  }

  for (let y = start.y + 1; y <= end.y - 1; y += 1) {
    const line = getLine(y);
    if (!line) {
      continue;
    }
    const lineText = line.translateToString(false, 0, cols);
    if (line.isWrapped && parts.length > 0) {
      parts[parts.length - 1] += lineText;
    } else {
      parts.push(lineText);
    }
  }

  const last = getLine(end.y);
  if (last) {
    const lineText = last.translateToString(false, 0, end.x);
    if (last.isWrapped && parts.length > 0) {
      parts[parts.length - 1] += lineText;
    } else {
      parts.push(lineText);
    }
  }

  return normalizeSelectionSpaces(parts.join(""));
}

/** Match xterm selectionText: NBSP → regular space. */
function normalizeSelectionSpaces(text: string): string {
  return text.replace(/\u00a0/g, " ");
}

/**
 * Character count of a buffer selection range `[start, end)`.
 * Uses cell walk (not translateToString) so empty pad cells don't become
 * phantom spaces that inflate the delete count.
 */
export function countCharactersInSelectionRange(input: {
  start: TerminalBufferCell;
  end: TerminalBufferCell;
  cols: number;
  getCell: TerminalBufferCellLookup;
}): number {
  const { start, end, cols, getCell } = input;
  return Math.abs(
    countCharactersBetweenBufferPositions({
      from: start,
      to: end,
      cols,
      getCell,
    }),
  );
}

/**
 * Resolve how many editor characters a selection covers.
 *
 * Prefer a buffer cell walk when available so move distance and delete count
 * share one unit system (critical for CJK / fullwidth mixes). Fall back to the
 * visible selection string when the buffer is unavailable or empty.
 */
export function resolveSelectionDeleteCount(input: {
  selectionText: string;
  start: TerminalBufferCell;
  end: TerminalBufferCell;
  cols: number;
  getCell?: TerminalBufferCellLookup;
}): number {
  if (input.getCell) {
    const fromBuffer = countCharactersInSelectionRange({
      start: input.start,
      end: input.end,
      cols: input.cols,
      getCell: input.getCell,
    });
    if (fromBuffer > 0) {
      return fromBuffer;
    }
  }
  return countEditorCharacters(input.selectionText);
}

/**
 * Text to re-insert on undo after a selection delete.
 * Prefers the visible selection string; falls back to a buffer extract.
 */
export function resolveDeletedSelectionText(input: {
  selectionText: string;
  start: TerminalBufferCell;
  end: TerminalBufferCell;
  cols: number;
  getLine?: TerminalBufferLineLookup;
}): string {
  const fromSelection = input.selectionText.replace(/\u00a0/g, " ");
  if (countEditorCharacters(fromSelection) > 0) {
    return fromSelection;
  }
  if (!input.getLine) {
    return fromSelection;
  }
  const ordered =
    compareBufferCells(input.start, input.end) <= 0
      ? { start: input.start, end: input.end }
      : { start: input.end, end: input.start };
  return extractBufferRangeText({
    start: ordered.start,
    end: ordered.end,
    cols: input.cols,
    getLine: input.getLine,
  });
}

/**
 * Character immediately before the shell cursor (what plain Backspace removes).
 * Walks left across wide-glyph halves and soft-wrapped lines. Returns null when
 * there is no content cell to the left (start of unwrapped line / empty pad).
 */
export function resolveCharacterBeforeCursor(input: {
  cursorCol: number;
  cursorRow: number;
  baseY: number;
  cols: number;
  getCell: TerminalBufferCellLookup;
  isLineWrapped: (absoluteY: number) => boolean;
}): string | null {
  const { cursorCol, cursorRow, baseY, cols, getCell, isLineWrapped } = input;
  if (cols <= 0) {
    return null;
  }

  let x = cursorCol;
  let y = baseY + cursorRow;

  // Step one cell left (across wrap if needed).
  if (x > 0) {
    x -= 1;
  } else if (isLineWrapped(y)) {
    y -= 1;
    x = cols - 1;
  } else {
    // Start of an unwrapped line — nothing for the line editor to erase.
    return null;
  }

  // Skip empty pad cells walking further left (shell won't delete these either).
  let steps = 0;
  const maxSteps = Math.max(cols * 4, 1);
  while (steps++ < maxSteps) {
    const cell = getCell(y, x);
    if (!cell) {
      return null;
    }
    // Trailing half of a wide glyph → move to the head cell.
    if (cell.width === 0) {
      if (x > 0) {
        x -= 1;
        continue;
      }
      if (isLineWrapped(y)) {
        y -= 1;
        x = cols - 1;
        continue;
      }
      return null;
    }
    if (cell.chars) {
      return cell.chars;
    }
    // Empty width-1 pad — keep walking left.
    if (x > 0) {
      x -= 1;
      continue;
    }
    if (isLineWrapped(y)) {
      y -= 1;
      x = cols - 1;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Build arrow-key sequences that move the shell cursor from the current cell to
 * the target cell.
 *
 * When `getCell` is provided (preferred), distance is measured in **characters**
 * so mixed CJK/ASCII/symbol lines stay correct. Without `getCell`, falls back
 * to cell-distance (ASCII-only safe).
 */
export function buildMoveCursorToViewportCellSequence(input: {
  targetCol: number;
  targetRow: number;
  cursorCol: number;
  cursorRow: number;
  cols: number;
  applicationCursorKeys: boolean;
  /** True when the active buffer has scrollback (normal buffer). */
  horizontalOnly: boolean;
  /** Absolute buffer Y of viewport row 0 (`buffer.baseY`). */
  baseY?: number;
  getCell?: TerminalBufferCellLookup;
}): string {
  const {
    targetCol,
    targetRow,
    cursorCol,
    cursorRow,
    cols,
    applicationCursorKeys,
    horizontalOnly,
    baseY = 0,
    getCell,
  } = input;

  if (cols <= 0) {
    return "";
  }

  // Allow col === cols (exclusive end-of-line / "past last cell").
  const start = clampCell(cursorCol, cursorRow, cols, /* allowPastEnd */ true);
  let target = clampCell(targetCol, targetRow, cols, /* allowPastEnd */ true);

  if (getCell) {
    target = {
      ...target,
      col: snapPlacementColumnToCharacterBoundary({
        col: target.col,
        absoluteY: baseY + target.row,
        cols,
        getCell,
      }),
    };
  }

  if (start.col === target.col && start.row === target.row) {
    return "";
  }

  if (getCell && (horizontalOnly || start.row === target.row)) {
    const signed = countCharactersBetweenBufferPositions({
      from: { x: start.col, y: baseY + start.row },
      to: { x: target.col, y: baseY + target.row },
      cols,
      getCell,
    });
    if (signed === 0) {
      return "";
    }
    const direction: TerminalArrowDirection = signed < 0 ? "D" : "C";
    return repeatSequence(Math.abs(signed), arrowSequence(direction, applicationCursorKeys));
  }

  if (horizontalOnly || start.row === target.row) {
    // Fallback: cell-distance (incorrect for wide glyphs — only used without buffer).
    const cells = linearCellOffset(start, target, cols);
    if (cells === 0) {
      return "";
    }
    const direction: TerminalArrowDirection = cells < 0 ? "D" : "C";
    return repeatSequence(Math.abs(cells), arrowSequence(direction, applicationCursorKeys));
  }

  // Alternate buffer without character map: move vertically then horizontally by cells.
  const rowDelta = target.row - start.row;
  const colDelta = target.col - start.col;
  const vertical: TerminalArrowDirection = rowDelta < 0 ? "A" : "B";
  const horizontal: TerminalArrowDirection = colDelta < 0 ? "D" : "C";
  return (
    repeatSequence(Math.abs(rowDelta), arrowSequence(vertical, applicationCursorKeys)) +
    repeatSequence(Math.abs(colDelta), arrowSequence(horizontal, applicationCursorKeys))
  );
}

/**
 * Linear cell offset along wrapped rows (positive = right/down, negative = left/up).
 * Prefer {@link countCharactersBetweenBufferPositions} for shell editing.
 */
export function linearCellOffset(
  from: TerminalViewportCell,
  to: TerminalViewportCell,
  cols: number,
): number {
  return to.row * cols + to.col - (from.row * cols + from.col);
}

function clampCell(
  col: number,
  row: number,
  cols: number,
  allowPastEnd = false,
): TerminalViewportCell {
  const maxCol = Math.max(allowPastEnd ? cols : cols - 1, 0);
  return {
    col: Math.min(Math.max(Math.floor(col), 0), maxCol),
    row: Math.max(Math.floor(row), 0),
  };
}

/**
 * Count characters the shell should delete for a selection string.
 */
export function countSelectionDeleteUnits(selectionText: string): number {
  return countEditorCharacters(selectionText);
}

/**
 * Whether a buffer-absolute selection lies entirely on the wrapped line group
 * that contains the cursor (the editable command line).
 */
export function isSelectionOnCursorWrappedLine(input: {
  selectionStart: TerminalBufferCell;
  selectionEnd: TerminalBufferCell;
  cursorAbsY: number;
  isLineWrapped: (absoluteY: number) => boolean;
}): boolean {
  const { selectionStart, selectionEnd, cursorAbsY, isLineWrapped } = input;
  const range = resolveWrappedLineRange({
    absoluteY: cursorAbsY,
    isLineWrapped,
  });
  const startY = Math.min(selectionStart.y, selectionEnd.y);
  const endY = Math.max(selectionStart.y, selectionEnd.y);
  return startY >= range.first && endY <= range.last;
}

/**
 * Whether a viewport cell is on the wrapped line group that contains the cursor.
 */
export function isViewportCellOnCursorWrappedLine(input: {
  targetRow: number;
  cursorRow: number;
  baseY: number;
  isLineWrapped: (absoluteY: number) => boolean;
}): boolean {
  const { targetRow, cursorRow, baseY, isLineWrapped } = input;
  const range = resolveWrappedLineRange({
    absoluteY: baseY + cursorRow,
    isLineWrapped,
  });
  const targetAbsY = baseY + targetRow;
  return targetAbsY >= range.first && targetAbsY <= range.last;
}

export function resolveWrappedLineRange(input: {
  absoluteY: number;
  isLineWrapped: (absoluteY: number) => boolean;
  /** Optional upper bound so we don't walk forever (buffer length - 1). */
  maxY?: number;
}): { first: number; last: number } {
  const { absoluteY, isLineWrapped, maxY = absoluteY + 10_000 } = input;
  let first = absoluteY;
  while (first > 0 && isLineWrapped(first)) {
    first -= 1;
  }
  let last = absoluteY;
  while (last < maxY && isLineWrapped(last + 1)) {
    last += 1;
  }
  return { first, last };
}

export type SelectionDeleteKey = "Backspace" | "Delete";

/**
 * Build a key sequence that deletes the current selection like a text field.
 *
 * - **Backspace**: move to selection *end*, then N × DEL (`\x7f`)
 * - **Delete**: move to selection *start*, then N × forward-delete (`CSI 3~`)
 *
 * Move distance and N share the same buffer cell-walk character units so mixed
 * CJK / ASCII / fullwidth lines don't overshoot.
 */
export function buildDeleteSelectionSequence(input: {
  selectionStart: TerminalBufferCell;
  selectionEnd: TerminalBufferCell;
  selectionText: string;
  cursorCol: number;
  cursorRow: number;
  baseY: number;
  cols: number;
  rows: number;
  applicationCursorKeys: boolean;
  horizontalOnly: boolean;
  getCell?: TerminalBufferCellLookup;
  /** Which key the user pressed; defaults to Backspace behavior. */
  deleteKey?: SelectionDeleteKey;
}): string | null {
  const {
    selectionStart,
    selectionEnd,
    selectionText,
    cursorCol,
    cursorRow,
    baseY,
    cols,
    rows,
    applicationCursorKeys,
    horizontalOnly,
    getCell,
    deleteKey = "Backspace",
  } = input;

  // Normalize so start is before end (buffer order).
  const reversed = compareBufferCells(selectionStart, selectionEnd) > 0;
  let start = reversed ? selectionEnd : selectionStart;
  let end = reversed ? selectionStart : selectionEnd;

  if (getCell) {
    start = snapSelectionStartToGlyph({ position: start, getCell });
    end = snapSelectionEndExclusiveToGlyph({ position: end, cols, getCell });
  }

  if (compareBufferCells(start, end) >= 0) {
    return null;
  }

  const deleteCount = resolveSelectionDeleteCount({
    selectionText,
    start,
    end,
    cols,
    getCell,
  });
  if (deleteCount <= 0) {
    return null;
  }

  // Target cell the shell cursor must reach before deleting.
  const target = deleteKey === "Delete" ? start : end;
  const targetViewportRow = target.y - baseY;
  if (targetViewportRow < 0 || targetViewportRow >= rows) {
    return null;
  }

  let move = "";
  if (getCell) {
    const cursorSnapped: TerminalBufferCell = {
      x: snapPlacementColumnToCharacterBoundary({
        col: cursorCol,
        absoluteY: baseY + cursorRow,
        cols,
        getCell,
      }),
      y: baseY + cursorRow,
    };
    const signed = countCharactersBetweenBufferPositions({
      from: cursorSnapped,
      to: target,
      cols,
      getCell,
    });
    if (signed !== 0) {
      const direction: TerminalArrowDirection = signed < 0 ? "D" : "C";
      move = repeatSequence(Math.abs(signed), arrowSequence(direction, applicationCursorKeys));
    }
  } else {
    move = buildMoveCursorToViewportCellSequence({
      targetCol: target.x,
      targetRow: targetViewportRow,
      cursorCol,
      cursorRow,
      cols,
      applicationCursorKeys,
      horizontalOnly,
      baseY,
    });
  }

  // Forward delete (Delete key) vs backward delete (Backspace).
  const erase = deleteKey === "Delete" ? "\x1b[3~".repeat(deleteCount) : "\x7f".repeat(deleteCount);
  return move + erase;
}

/**
 * True when a plain click should reposition the shell cursor.
 */
export function shouldMoveCursorOnClick(input: {
  button: number;
  detail: number;
  /** Elapsed ms from mousedown to mouseup. */
  elapsedMs: number;
  hasMeaningfulSelection: boolean;
  mouseTrackingMode: string;
  scrolledToBottom: boolean;
  suppressInput: boolean;
  maxClickMs?: number;
}): boolean {
  const maxClickMs = input.maxClickMs ?? 500;
  if (input.suppressInput) {
    return false;
  }
  if (input.button !== 0) {
    return false;
  }
  if (input.detail !== 1) {
    return false;
  }
  if (input.elapsedMs >= maxClickMs) {
    return false;
  }
  if (input.hasMeaningfulSelection) {
    return false;
  }
  if (input.mouseTrackingMode !== "none") {
    return false;
  }
  if (!input.scrolledToBottom) {
    return false;
  }
  return true;
}

/**
 * Build a cell lookup from an xterm-like buffer active object.
 */
export function createBufferCellLookup(buffer: {
  getLine: (y: number) =>
    | {
        getCell: (x: number) => { getWidth: () => number; getChars: () => string } | undefined;
      }
    | undefined;
}): TerminalBufferCellLookup {
  return (absoluteY, col) => {
    const line = buffer.getLine(absoluteY);
    if (!line) {
      return null;
    }
    const cell = line.getCell(col);
    if (!cell) {
      return null;
    }
    return {
      width: cell.getWidth(),
      chars: cell.getChars(),
    };
  };
}

/**
 * Build a line lookup for translateToString-based helpers.
 */
export function createBufferLineLookup(buffer: {
  getLine: (y: number) =>
    | {
        translateToString: (
          trimRight?: boolean,
          startColumn?: number,
          endColumn?: number,
        ) => string;
        isWrapped: boolean;
      }
    | undefined;
}): TerminalBufferLineLookup {
  return (absoluteY) => {
    const line = buffer.getLine(absoluteY);
    if (!line) {
      return null;
    }
    return {
      translateToString: (trimRight, startColumn, endColumn) =>
        line.translateToString(trimRight, startColumn, endColumn),
      isWrapped: line.isWrapped,
    };
  };
}
