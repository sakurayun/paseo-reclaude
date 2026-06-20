import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { FileBackedPromptPresetsStore } from "./prompt-presets-store.js";

describe("FileBackedPromptPresetsStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paseo-prompt-presets-"));
    filePath = join(tempDir, "prompt-presets.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("applies newer pushes, normalizes presets, and rejects stale revisions", async () => {
    const store = new FileBackedPromptPresetsStore(filePath, createTestLogger());
    await store.initialize();

    const accepted = store.applyPush({
      revision: 1,
      presets: ["  fix tests  ", "fix tests", "", "ship it"],
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.current).toMatchObject({
      revision: 1,
      presets: ["fix tests", "ship it"],
    });

    const rejected = store.applyPush({ revision: 1, presets: ["stale"] });

    expect(rejected.accepted).toBe(false);
    expect(rejected.current.presets).toEqual(["fix tests", "ship it"]);
  });

  it("persists and reloads the envelope", async () => {
    const store = new FileBackedPromptPresetsStore(filePath, createTestLogger());
    await store.initialize();

    store.applyPush({ revision: 2, presets: ["review", "release"] });
    await store.flush();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 2,
      presets: ["review", "release"],
    });

    const reloaded = new FileBackedPromptPresetsStore(filePath, createTestLogger());
    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      revision: 2,
      presets: ["review", "release"],
    });
  });
});
