import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearGrokLocalContextWindowCache,
  extractContextWindowFromMeta,
  loadGrokLocalContextWindows,
  parseGrokConfigContextWindows,
  parseGrokModelsCacheContextWindows,
  resolveGrokContextWindowMaxTokens,
  resolveGrokKnownContextWindow,
} from "./grok-model-context.js";

describe("extractContextWindowFromMeta", () => {
  it("accepts totalContextTokens and common aliases", () => {
    expect(extractContextWindowFromMeta({ totalContextTokens: 500_000 })).toBe(500_000);
    expect(extractContextWindowFromMeta({ context_window: 200_000 })).toBe(200_000);
    expect(extractContextWindowFromMeta({ contextWindowTokens: "256000" })).toBe(256_000);
    expect(extractContextWindowFromMeta({ contextWindow: 0 })).toBeUndefined();
    expect(extractContextWindowFromMeta(null)).toBeUndefined();
  });
});

describe("parseGrokConfigContextWindows", () => {
  it('reads [model."id"] context_window entries', () => {
    const toml = `
[cli]
auto_update = true

[model."grok-4.5"]
model = "grok-4.5"
context_window = 200000

[model.grok-build]
context_window = 256000

[session]
auto_compact_threshold_percent = 85
`;
    const map = parseGrokConfigContextWindows(toml);
    expect(map.get("grok-4.5")).toBe(200_000);
    expect(map.get("grok-build")).toBe(256_000);
  });
});

describe("parseGrokModelsCacheContextWindows", () => {
  it("reads models[id].info.context_window", () => {
    const raw = JSON.stringify({
      models: {
        "grok-4.5": { info: { id: "grok-4.5", context_window: 500_000 } },
        broken: { info: { context_window: "nope" } },
      },
    });
    const map = parseGrokModelsCacheContextWindows(raw);
    expect(map.get("grok-4.5")).toBe(500_000);
    expect(map.has("broken")).toBe(false);
  });
});

describe("resolveGrokContextWindowMaxTokens", () => {
  let homeDir: string;

  afterEach(() => {
    clearGrokLocalContextWindowCache();
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("prefers config.toml over ACP meta and models_cache", () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-ctx-"));
    writeFileSync(
      join(homeDir, "models_cache.json"),
      JSON.stringify({
        models: { "grok-4.5": { info: { context_window: 500_000 } } },
      }),
    );
    writeFileSync(join(homeDir, "config.toml"), `[model."grok-4.5"]\ncontext_window = 200000\n`);

    const local = loadGrokLocalContextWindows(homeDir);
    expect(
      resolveGrokContextWindowMaxTokens({
        modelId: "grok-4.5",
        meta: { totalContextTokens: 500_000 },
        localWindows: local,
      }),
    ).toBe(200_000);
  });

  it("falls back to ACP meta when config has no entry", () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-ctx-"));
    writeFileSync(
      join(homeDir, "models_cache.json"),
      JSON.stringify({
        models: { "grok-4.5": { info: { context_window: 500_000 } } },
      }),
    );

    const local = loadGrokLocalContextWindows(homeDir);
    expect(
      resolveGrokContextWindowMaxTokens({
        modelId: "grok-4.5",
        meta: { totalContextTokens: 400_000 },
        localWindows: local,
      }),
    ).toBe(400_000);
  });

  it("falls back to models_cache then known defaults", () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-ctx-"));
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(homeDir, "models_cache.json"),
      JSON.stringify({
        models: { "grok-4.5": { info: { context_window: 500_000 } } },
      }),
    );

    const local = loadGrokLocalContextWindows(homeDir);
    expect(
      resolveGrokContextWindowMaxTokens({
        modelId: "grok-4.5",
        localWindows: local,
      }),
    ).toBe(500_000);

    expect(
      resolveGrokContextWindowMaxTokens({
        modelId: "grok-3-mini",
        localWindows: { config: new Map(), cache: new Map() },
      }),
    ).toBe(131_072);
  });

  it("resolves known model defaults by prefix", () => {
    expect(resolveGrokKnownContextWindow("grok-4.5-preview")).toBe(500_000);
    expect(resolveGrokKnownContextWindow("unknown-model")).toBeUndefined();
  });
});
