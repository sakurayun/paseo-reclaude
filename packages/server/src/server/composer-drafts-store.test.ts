import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { FileBackedComposerDraftsStore } from "./composer-drafts-store.js";

describe("FileBackedComposerDraftsStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paseo-composer-drafts-"));
    filePath = join(tempDir, "composer-drafts.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defaults to an empty envelope at revision 0", async () => {
    const store = new FileBackedComposerDraftsStore(filePath, createTestLogger());
    await store.initialize();

    expect(store.get()).toMatchObject({ revision: 0, drafts: {} });
  });

  it("applies newer pushes and rejects stale or equal revisions", async () => {
    const store = new FileBackedComposerDraftsStore(filePath, createTestLogger());
    await store.initialize();

    const accepted = store.applyPush({
      revision: 1,
      drafts: { "agent:abc": { text: "hello" }, "agent:def": { text: "world" } },
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.current).toMatchObject({
      revision: 1,
      drafts: { "agent:abc": { text: "hello" }, "agent:def": { text: "world" } },
    });

    const stale = store.applyPush({ revision: 1, drafts: { "agent:abc": { text: "stale" } } });

    expect(stale.accepted).toBe(false);
    expect(stale.current.drafts).toEqual({
      "agent:abc": { text: "hello" },
      "agent:def": { text: "world" },
    });

    const newer = store.applyPush({ revision: 2, drafts: { "agent:abc": { text: "updated" } } });

    expect(newer.accepted).toBe(true);
    expect(newer.current.drafts).toEqual({ "agent:abc": { text: "updated" } });
  });

  it("persists and reloads the envelope", async () => {
    const store = new FileBackedComposerDraftsStore(filePath, createTestLogger());
    await store.initialize();

    store.applyPush({ revision: 3, drafts: { "agent:abc": { text: "draft" } } });
    await store.flush();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 3,
      drafts: { "agent:abc": { text: "draft" } },
    });

    const reloaded = new FileBackedComposerDraftsStore(filePath, createTestLogger());
    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      revision: 3,
      drafts: { "agent:abc": { text: "draft" } },
    });
  });
});
