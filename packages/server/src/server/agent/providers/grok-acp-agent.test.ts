import { describe, expect, it, vi } from "vitest";
import type { AgentModelDefinition } from "../agent-sdk-types.js";
import {
  GROK_BYPASS_MODE_ID,
  GROK_DEFAULT_MODE_ID,
  injectGrokAlwaysApproveArgs,
  transformGrokLaunchArgs,
  transformGrokModeId,
  transformGrokModels,
  transformGrokSessionResponse,
  writeGrokProviderMode,
  writeGrokThinkingOption,
} from "./grok-acp-agent.js";
import { deriveModelDefinitionsFromACP, mapACPUsage, mapACPUsageFromUnknown } from "./acp-agent.js";

describe("transformGrokModels", () => {
  it("maps reasoningEfforts into thinking options and context window", () => {
    const models: AgentModelDefinition[] = [
      {
        provider: "grok",
        // Use an id that will not collide with the developer's ~/.grok/config.toml
        // so ACP meta remains the source of truth in this unit test.
        id: "grok-4.5-test-only",
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
    // No local config entry for this id → ACP meta wins.
    expect(transformed[0]?.contextWindowMaxTokens).toBe(500_000);
    expect(transformed[1]?.thinkingOptions).toBeUndefined();
    expect(transformed[1]?.contextWindowMaxTokens).toBe(200_000);
  });

  it("accepts context_window alias on metadata when totalContextTokens is absent", () => {
    const models: AgentModelDefinition[] = [
      {
        provider: "grok",
        id: "custom-proxy-model",
        label: "Custom",
        metadata: { context_window: 128_000 },
      },
    ];
    const transformed = transformGrokModels(models);
    expect(transformed[0]?.contextWindowMaxTokens).toBe(128_000);
    expect(transformed[0]?.metadata).toMatchObject({
      totalContextTokens: 128_000,
      contextWindowMaxTokens: 128_000,
    });
  });
});

describe("deriveModelDefinitionsFromACP preserves Grok _meta", () => {
  it("copies totalContextTokens and reasoningEfforts into model definitions", () => {
    const models = deriveModelDefinitionsFromACP("grok", {
      currentModelId: "grok-4.5-test-only",
      availableModels: [
        {
          modelId: "grok-4.5-test-only",
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

  it("maps context_window alias from ACP _meta", () => {
    const models = deriveModelDefinitionsFromACP("grok", {
      currentModelId: "proxy-model",
      availableModels: [
        {
          modelId: "proxy-model",
          name: "Proxy",
          _meta: { context_window: 200_000 },
        },
      ],
    });
    expect(models[0]?.contextWindowMaxTokens).toBe(200_000);
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

describe("Grok permission / bypass mode", () => {
  it("injects --always-approve before stdio", () => {
    expect(injectGrokAlwaysApproveArgs(["agent", "stdio"])).toEqual([
      "agent",
      "--always-approve",
      "stdio",
    ]);
    expect(injectGrokAlwaysApproveArgs(["agent", "--always-approve", "stdio"])).toEqual([
      "agent",
      "--always-approve",
      "stdio",
    ]);
  });

  it("only rewrites launch args for bypass mode", () => {
    expect(transformGrokLaunchArgs(["agent", "stdio"], GROK_DEFAULT_MODE_ID)).toEqual([
      "agent",
      "stdio",
    ]);
    expect(transformGrokLaunchArgs(["agent", "stdio"], GROK_BYPASS_MODE_ID)).toEqual([
      "agent",
      "--always-approve",
      "stdio",
    ]);
  });

  it("keeps permission modes in session response (ignores effort as mode)", () => {
    const transformed = transformGrokSessionResponse({
      sessionId: "s1",
      modes: {
        currentModeId: "high",
        availableModes: [
          { id: "high", name: "High" },
          { id: "low", name: "Low" },
        ],
      },
    });
    expect(transformed.modes?.currentModeId).toBe(GROK_DEFAULT_MODE_ID);
    expect(transformed.modes?.availableModes?.map((mode) => mode.id)).toEqual([
      GROK_DEFAULT_MODE_ID,
      GROK_BYPASS_MODE_ID,
    ]);
  });

  it("handles permission modes locally without a blocking ACP prompt", async () => {
    const prompt = vi.fn(async () => ({}));
    const setSessionMode = vi.fn();
    const toBypass = await writeGrokProviderMode({
      connection: { prompt, setSessionMode } as never,
      sessionId: "s1",
      requestedModeId: GROK_BYPASS_MODE_ID,
      currentModeId: GROK_DEFAULT_MODE_ID,
      selection: {
        hasAvailableModes: true,
        availableMode: { id: GROK_BYPASS_MODE_ID, label: "Always Approve" },
        configOption: null,
        configChoice: null,
      },
      configOptions: [],
      logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
    });
    expect(toBypass).toEqual({ handled: true, currentModeId: GROK_BYPASS_MODE_ID });

    const toAsk = await writeGrokProviderMode({
      connection: { prompt, setSessionMode } as never,
      sessionId: "s1",
      requestedModeId: GROK_DEFAULT_MODE_ID,
      currentModeId: GROK_BYPASS_MODE_ID,
      selection: {
        hasAvailableModes: true,
        availableMode: { id: GROK_DEFAULT_MODE_ID, label: "Always Ask" },
        configOption: null,
        configChoice: null,
      },
      configOptions: [],
      logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
    });
    expect(toAsk).toEqual({ handled: true, currentModeId: GROK_DEFAULT_MODE_ID });

    // A full-turn prompt would freeze create_agent while applyConfiguredOverrides
    // awaits setMode (draft composer appears stuck after send).
    expect(prompt).not.toHaveBeenCalled();
    expect(setSessionMode).not.toHaveBeenCalled();
  });

  it("ignores effort mode ids in modeId transformer", () => {
    expect(transformGrokModeId("high")).toBeNull();
    expect(transformGrokModeId(GROK_BYPASS_MODE_ID)).toBe(GROK_BYPASS_MODE_ID);
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
