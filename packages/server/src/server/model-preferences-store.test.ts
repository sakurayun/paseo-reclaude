import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { FileBackedModelPreferencesStore } from "./model-preferences-store.js";

describe("FileBackedModelPreferencesStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paseo-model-preferences-"));
    filePath = join(tempDir, "model-preferences.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defaults to an empty envelope at revision 0", async () => {
    const store = new FileBackedModelPreferencesStore(filePath, createTestLogger());
    await store.initialize();

    expect(store.get()).toMatchObject({ revision: 0, preferences: {} });
  });

  it("applies newer pushes and rejects stale or equal revisions", async () => {
    const store = new FileBackedModelPreferencesStore(filePath, createTestLogger());
    await store.initialize();

    const accepted = store.applyPush({
      revision: 1,
      preferences: {
        provider: "claude",
        favoriteModels: [{ provider: "claude", modelId: "opus" }],
      },
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.current).toMatchObject({
      revision: 1,
      preferences: {
        provider: "claude",
        favoriteModels: [{ provider: "claude", modelId: "opus" }],
      },
    });

    const stale = store.applyPush({ revision: 1, preferences: { provider: "codex" } });

    expect(stale.accepted).toBe(false);
    expect(stale.current.preferences).toEqual({
      provider: "claude",
      favoriteModels: [{ provider: "claude", modelId: "opus" }],
    });

    const newer = store.applyPush({ revision: 2, preferences: { provider: "codex" } });

    expect(newer.accepted).toBe(true);
    expect(newer.current.preferences).toEqual({ provider: "codex" });
  });

  it("persists and reloads the envelope", async () => {
    const store = new FileBackedModelPreferencesStore(filePath, createTestLogger());
    await store.initialize();

    store.applyPush({
      revision: 3,
      preferences: { provider: "claude", providerPreferences: { claude: { model: "opus" } } },
    });
    await store.flush();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 3,
      preferences: { provider: "claude", providerPreferences: { claude: { model: "opus" } } },
    });

    const reloaded = new FileBackedModelPreferencesStore(filePath, createTestLogger());
    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      revision: 3,
      preferences: { provider: "claude", providerPreferences: { claude: { model: "opus" } } },
    });
  });
});
