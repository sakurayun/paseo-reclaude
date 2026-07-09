import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { FileBackedTerminalHistoryStore } from "./terminal-history-store.js";

function createStore(dir: string) {
  return new FileBackedTerminalHistoryStore(
    join(dir, "terminal-history.json"),
    pino({ level: "silent" }),
  );
}

describe("FileBackedTerminalHistoryStore", () => {
  it("appends newest-first, dedupes by id, and survives a reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-terminal-history-"));
    try {
      const store = createStore(dir);
      await store.initialize();

      store.append({ id: "a", name: "A", cwd: "/w", exitCode: 0, closedAt: 1 });
      store.append({ id: "b", name: "B", cwd: "/w", workspaceId: "ws", exitCode: 1, closedAt: 2 });
      store.append({ id: "a", name: "A2", cwd: "/w", exitCode: null, closedAt: 3 });
      await store.flush();

      expect(store.list().map((entry) => entry.id)).toEqual(["a", "b"]);
      expect(store.list()[0]?.name).toBe("A2");

      const reloaded = createStore(dir);
      await reloaded.initialize();
      expect(reloaded.list().map((entry) => entry.id)).toEqual(["a", "b"]);
      expect(reloaded.list()[1]?.workspaceId).toBe("ws");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
