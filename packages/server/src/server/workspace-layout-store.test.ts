import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileBackedWorkspaceLayoutStore } from "./workspace-layout-store.js";

const logger = pino({ level: "silent" });

describe("FileBackedWorkspaceLayoutStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-layout-"));
    filePath = path.join(dir, "workspace-layouts.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects a stale revision and keeps the newer layout (last-write-wins)", async () => {
    const store = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await store.initialize();

    const first = store.applyPush({ workspaceId: "w1", revision: 5, layout: { tag: "five" } });
    expect(first.accepted).toBe(true);
    expect(first.current.revision).toBe(5);

    const stale = store.applyPush({ workspaceId: "w1", revision: 3, layout: { tag: "three" } });
    expect(stale.accepted).toBe(false);
    expect(stale.current.revision).toBe(5);
    expect(store.get("w1")?.layout).toEqual({ tag: "five" });

    const equal = store.applyPush({
      workspaceId: "w1",
      revision: 5,
      layout: { tag: "five-again" },
    });
    expect(equal.accepted).toBe(false); // not strictly greater
    expect(store.get("w1")?.layout).toEqual({ tag: "five" });

    const newer = store.applyPush({ workspaceId: "w1", revision: 6, layout: { tag: "six" } });
    expect(newer.accepted).toBe(true);
    expect(store.get("w1")?.layout).toEqual({ tag: "six" });

    // applyPush persists fire-and-forget; let writes settle before afterEach removes
    // the temp dir, otherwise the rm races an in-flight write.
    await store.flush();
  });

  it("persists layouts across a reload", async () => {
    const store = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await store.initialize();
    store.applyPush({ workspaceId: "w1", revision: 2, layout: { root: { kind: "pane" } } });
    store.applyPush({ workspaceId: "w2", revision: 9, layout: { root: { kind: "group" } } });
    await store.flush();

    const reloaded = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await reloaded.initialize();
    expect(reloaded.get("w1")).toMatchObject({ workspaceId: "w1", revision: 2 });
    expect(reloaded.get("w2")).toMatchObject({ workspaceId: "w2", revision: 9 });
    expect(reloaded.get("w1")?.layout).toEqual({ root: { kind: "pane" } });
  });

  it("removes a workspace layout and the removal survives reload", async () => {
    const store = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await store.initialize();
    store.applyPush({ workspaceId: "w1", revision: 1, layout: {} });
    await store.flush();

    await store.remove("w1");
    expect(store.get("w1")).toBeNull();

    const reloaded = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await reloaded.initialize();
    expect(reloaded.get("w1")).toBeNull();
  });

  it("returns null for an unknown workspace", async () => {
    const store = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await store.initialize();
    expect(store.get("missing")).toBeNull();
  });

  it("serializes concurrent pushes without corrupting the file", async () => {
    const store = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await store.initialize();
    for (let revision = 1; revision <= 25; revision += 1) {
      store.applyPush({ workspaceId: "w1", revision, layout: { revision } });
    }
    await store.flush();

    const reloaded = new FileBackedWorkspaceLayoutStore(filePath, logger);
    await reloaded.initialize();
    expect(reloaded.get("w1")?.revision).toBe(25);
  });
});
