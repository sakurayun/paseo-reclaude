import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import { FileBackedAppearanceSettingsStore } from "./appearance-settings-store.js";

describe("FileBackedAppearanceSettingsStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paseo-appearance-settings-"));
    filePath = join(tempDir, "appearance-settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defaults to an empty envelope at revision 0", async () => {
    const store = new FileBackedAppearanceSettingsStore(filePath, createTestLogger());
    await store.initialize();

    expect(store.get()).toMatchObject({ revision: 0, settings: {} });
  });

  it("applies newer pushes and rejects stale or equal revisions", async () => {
    const store = new FileBackedAppearanceSettingsStore(filePath, createTestLogger());
    await store.initialize();

    const accepted = store.applyPush({
      revision: 1,
      settings: { theme: "dark", terminalColorScheme: "dracula" },
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.current).toMatchObject({
      revision: 1,
      settings: { theme: "dark", terminalColorScheme: "dracula" },
    });

    const stale = store.applyPush({ revision: 1, settings: { theme: "light" } });

    expect(stale.accepted).toBe(false);
    expect(stale.current.settings).toEqual({ theme: "dark", terminalColorScheme: "dracula" });

    const newer = store.applyPush({ revision: 2, settings: { theme: "light" } });

    expect(newer.accepted).toBe(true);
    expect(newer.current.settings).toEqual({ theme: "light" });
  });

  it("persists and reloads the envelope", async () => {
    const store = new FileBackedAppearanceSettingsStore(filePath, createTestLogger());
    await store.initialize();

    store.applyPush({ revision: 3, settings: { theme: "ghostty", syntaxTheme: "one" } });
    await store.flush();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 3,
      settings: { theme: "ghostty", syntaxTheme: "one" },
    });

    const reloaded = new FileBackedAppearanceSettingsStore(filePath, createTestLogger());
    await reloaded.initialize();

    expect(reloaded.get()).toMatchObject({
      revision: 3,
      settings: { theme: "ghostty", syntaxTheme: "one" },
    });
  });
});
