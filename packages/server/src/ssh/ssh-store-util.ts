import { readFileSync } from "node:fs";
import type { z } from "zod";

// Tolerant JSON loader shared by the SSH stores. A corrupt or partially-written
// file must never crash daemon startup — every failure degrades to the fallback
// value and the next mutation rewrites a clean file. Mirrors the resilience
// contract in port-forward-manager.ts.
export function loadJsonFile<T>(storePath: string, schema: z.ZodType<T>, fallback: T): T {
  let content: string;
  try {
    content = readFileSync(storePath, "utf8");
  } catch {
    // Missing file (first run) or unreadable: start from the fallback.
    return fallback;
  }
  try {
    return schema.parse(JSON.parse(content));
  } catch {
    return fallback;
  }
}

// Chains atomic writes so concurrent mutations can't interleave their renames.
export function createPersistQueue(write: () => Promise<void> | void): () => void {
  let queue: Promise<void> = Promise.resolve();
  return function persist(): void {
    queue = queue
      .catch(() => undefined)
      .then(() => write())
      .catch(() => {
        // Persistence is best-effort; an I/O failure must not reject into the
        // synchronous caller or surface as an unhandled rejection.
      });
  };
}

// Fan-out to change listeners; a misbehaving listener can't break the others.
export function notifyListeners<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      // Ignore listener failures.
    }
  }
}
