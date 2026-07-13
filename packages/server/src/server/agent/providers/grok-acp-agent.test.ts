import { describe, expect, it, vi } from "vitest";
import type { AgentModelDefinition } from "../agent-sdk-types.js";
import { transformGrokModels, writeGrokThinkingOption } from "./grok-acp-agent.js";
import { deriveModelDefinitionsFromACP, mapACPUsage, mapACPUsageFromUnknown } from "./acp-agent.js";

describe("transformGrokModels", () => {
  it("maps reasoningEfforts into thinking options and context window", () => {
    const models: AgentModelDefinition[] = [
      {
        provider: "grok",
        id: "grok-4.5",
        label: "Grok 4.5",
        metadata: {
          totalContextTokens: 500_000,
          supportsReasoningEffort: true,
          reasoningEffort: "high",
          reasoningEfforts: [
            {
              id: "high",
              value: "high",
              label: "High Effort",
              description: "Highest quality",
              default: true,
            },
            { id: "medium", value: "medium", label: "Medium Effort", default: false },
            { id: "low", value: "low", label: "Low Effort", default: false },
          ],
        },
      },
      {
        provider: "grok",
        id: "grok-composer-2.5-fast",
        label: "Composer 2.5",
        metadata: { totalContextTokens: 200_000 },
      },
    ];

    const transformed = transformGrokModels(models);
    expect(transformed[0]?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "high", label: "High Effort", isDefault: true }),
      expect.objectContaining({ id: "medium", label: "Medium Effort" }),
      expect.objectContaining({ id: "low", label: "Low Effort" }),
    ]);
    expect(transformed[0]?.defaultThinkingOptionId).toBe("high");
    expect(transformed[0]?.contextWindowMaxTokens).toBe(500_000);
    expect(transformed[1]?.thinkingOptions).toBeUndefined();
    expect(transformed[1]?.contextWindowMaxTokens).toBe(200_000);
  });
});

describe("deriveModelDefinitionsFromACP preserves Grok _meta", () => {
  it("copies totalContextTokens and reasoningEfforts into model definitions", () => {
    const models = deriveModelDefinitionsFromACP("grok", {
      currentModelId: "grok-4.5",
      availableModels: [
        {
          modelId: "grok-4.5",
          name: "Grok 4.5",
          description: "frontier",
          _meta: {
            totalContextTokens: 500_000,
            reasoningEffort: "high",
            reasoningEfforts: [
              { id: "high", value: "high", label: "High Effort", default: true },
              { id: "low", value: "low", label: "Low Effort", default: false },
            ],
          },
        },
      ],
    });

    const transformed = transformGrokModels(models);
    expect(transformed[0]?.contextWindowMaxTokens).toBe(500_000);
    expect(transformed[0]?.thinkingOptions?.map((option) => option.id)).toEqual(["high", "low"]);
  });
});

describe("writeGrokThinkingOption", () => {
  it("writes effort through session/set_mode", async () => {
    const setSessionMode = vi.fn(async () => ({}));
    await writeGrokThinkingOption({ setSessionMode } as never, "session-1", "medium");
    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "medium",
    });
  });
});

describe("mapACPUsage context window", () => {
  it("maps totalTokens to contextWindowUsedTokens", () => {
    expect(
      mapACPUsage({
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      }),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      contextWindowUsedTokens: 110,
    });
  });

  it("maps Grok _meta usage blobs", () => {
    expect(
      mapACPUsageFromUnknown({
        inputTokens: 21085,
        outputTokens: 22,
        totalTokens: 21107,
        cachedReadTokens: 6016,
      }),
    ).toMatchObject({
      inputTokens: 21085,
      outputTokens: 22,
      cachedInputTokens: 6016,
      contextWindowUsedTokens: 21107,
    });
  });
});
