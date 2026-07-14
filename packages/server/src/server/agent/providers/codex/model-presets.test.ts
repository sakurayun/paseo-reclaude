import { describe, expect, test } from "vitest";

import {
  CODEX_MODEL_PRESETS,
  mergeCodexModelPresets,
  type CodexCatalogModel,
} from "./model-presets.js";

describe("mergeCodexModelPresets", () => {
  test("injects GPT-5.6 Sol/Terra/Luna when the runtime catalog is missing them", () => {
    const runtime: CodexCatalogModel[] = [
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
      },
    ];

    const merged = mergeCodexModelPresets(runtime);

    expect(merged.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]);
    // Runtime default wins over the Sol preset default.
    expect(merged.find((model) => model.id === "gpt-5.5")?.isDefault).toBe(true);
    expect(merged.find((model) => model.id === "gpt-5.6-sol")?.isDefault).toBe(false);

    const sol = merged.find((model) => model.id === "gpt-5.6-sol");
    expect(sol?.defaultReasoningEffort).toBe("low");
    expect(sol?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);

    const luna = merged.find((model) => model.id === "gpt-5.6-luna");
    expect(luna?.defaultReasoningEffort).toBe("medium");
    expect(luna?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("uses Sol as default when the runtime catalog has no default", () => {
    const merged = mergeCodexModelPresets([]);
    expect(merged.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(merged.find((model) => model.isDefault)?.id).toBe("gpt-5.6-sol");
  });

  test("keeps runtime entries and fills missing reasoning efforts from presets", () => {
    const runtime: CodexCatalogModel[] = [
      {
        id: "gpt-5.6-sol",
        displayName: "Custom Sol",
        description: "Custom description",
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Runtime low" },
          { reasoningEffort: "high" },
        ],
      },
      {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
      },
    ];

    const merged = mergeCodexModelPresets(runtime);
    const sol = merged.find((model) => model.id === "gpt-5.6-sol");

    expect(sol?.displayName).toBe("Custom Sol");
    expect(sol?.description).toBe("Custom description");
    expect(sol?.defaultReasoningEffort).toBe("high");
    expect(sol?.isDefault).toBe(true);
    expect(sol?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort)).toEqual([
      "low",
      "high",
      "medium",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(
      sol?.supportedReasoningEfforts?.find((entry) => entry.reasoningEffort === "low")?.description,
    ).toBe("Runtime low");
    expect(
      sol?.supportedReasoningEfforts?.find((entry) => entry.reasoningEffort === "ultra")
        ?.description,
    ).toBe("Maximum reasoning with automatic task delegation");

    expect(merged.map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4",
    ]);
  });

  test("presets match the Codex 5.6 family shape", () => {
    expect(CODEX_MODEL_PRESETS.map((preset) => preset.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(CODEX_MODEL_PRESETS[0]?.isDefault).toBe(true);
    expect(
      CODEX_MODEL_PRESETS[2]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).not.toContain("ultra");
  });
});
