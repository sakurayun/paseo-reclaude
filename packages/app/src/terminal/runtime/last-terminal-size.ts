import AsyncStorage from "@react-native-async-storage/async-storage";

export interface LastTerminalSize {
  rows: number;
  cols: number;
}

const STORAGE_KEY = "last-terminal-size";

let lastMeasuredTerminalSize: LastTerminalSize | null = null;

function isValidSize(value: unknown): value is LastTerminalSize {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const size = value as { rows?: unknown; cols?: unknown };
  return (
    typeof size.rows === "number" &&
    Number.isInteger(size.rows) &&
    size.rows > 0 &&
    typeof size.cols === "number" &&
    Number.isInteger(size.cols) &&
    size.cols > 0
  );
}

// Seed from the previous launch so even the first connect after startup gets
// a realistic size (window geometry rarely changes between launches).
void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (lastMeasuredTerminalSize !== null || !raw) {
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isValidSize(parsed)) {
      lastMeasuredTerminalSize = parsed;
    }
    return;
  })
  .catch(() => {
    // Best-effort seed only.
  });

// Best-effort size for terminals created before their pane exists (e.g. the
// SSH connect flow opening the remote pty): the most recent measurement from
// any terminal pane on this device. Panes share the same content area, so this
// is almost always right; the pane's claimed fit corrects small drift after
// mount. Starting the remote pty at the right size matters because the login
// banner renders immediately — a later resize cannot cleanly reflow output the
// remote positioned with absolute coordinates.
export function rememberMeasuredTerminalSize(size: LastTerminalSize): void {
  if (
    lastMeasuredTerminalSize &&
    lastMeasuredTerminalSize.rows === size.rows &&
    lastMeasuredTerminalSize.cols === size.cols
  ) {
    return;
  }
  lastMeasuredTerminalSize = size;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(size)).catch(() => {
    // Best-effort persistence only.
  });
}

export function getLastMeasuredTerminalSize(): LastTerminalSize | null {
  return lastMeasuredTerminalSize;
}
