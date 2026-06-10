import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelInfo, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryFactory, ClaudeQueryInput } from "./query.js";
import {
  decorateClaudeModelsWithSdkEfforts,
  getClaudeModels,
  normalizeClaudeRuntimeModelId,
} from "./models.js";

const createdClaudeConfigDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await Promise.all(
    createdClaudeConfigDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  createdClaudeConfigDirs.length = 0;
});

interface TestQuery extends Query {
  return: ReturnType<typeof vi.fn<() => Promise<IteratorResult<SDKMessage, void>>>>;
}

interface TestQueryHandle {
  query: TestQuery;
  supportedModels: ReturnType<typeof vi.fn<() => Promise<ModelInfo[]>>>;
  returnQuery: ReturnType<typeof vi.fn<() => Promise<IteratorResult<SDKMessage, void>>>>;
}

function createTestQuery(supportedModels: () => Promise<ModelInfo[]>): TestQueryHandle {
  const supportedModelsMock = vi.fn(supportedModels);
  const returnQuery = vi.fn(async () => ({ done: true, value: undefined }) as const);
  const query: TestQuery = {
    async next() {
      return { done: true, value: undefined };
    },
    return: returnQuery,
    async throw(error?: unknown) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setMaxThinkingTokens: vi.fn(async () => undefined),
    applyFlagSettings: vi.fn(async () => undefined),
    initializationResult: vi.fn(async () => {
      throw new Error("not implemented in test query");
    }),
    supportedCommands: vi.fn(async () => []),
    supportedModels: supportedModelsMock,
    supportedAgents: vi.fn(async () => []),
    mcpServerStatus: vi.fn(async () => []),
    reconnectMcpServer: vi.fn(async () => undefined),
    toggleMcpServer: vi.fn(async () => undefined),
    enableChannel: vi.fn(async () => undefined),
    mcpAuthenticate: vi.fn(async () => undefined),
    mcpClearAuth: vi.fn(async () => undefined),
    mcpSubmitOAuthCallbackUrl: vi.fn(async () => undefined),
    claudeAuthenticate: vi.fn(async () => undefined),
    claudeOAuthCallback: vi.fn(async () => undefined),
    claudeOAuthWaitForCompletion: vi.fn(async () => undefined),
    getContextUsage: vi.fn(async () => ({
      contextSize: 0,
      contextUsed: 0,
      contextRemaining: 0,
    })),
    readFile: vi.fn(async () => null),
    reloadPlugins: vi.fn(async () => undefined),
    setMcpServers: vi.fn(async () => undefined),
    accountInfo: vi.fn(async () => undefined),
  };

  return { query, supportedModels: supportedModelsMock, returnQuery };
}

function createQueryFactory(handle: TestQueryHandle): {
  queryFactory: ClaudeQueryFactory;
  inputs: ClaudeQueryInput[];
} {
  const inputs: ClaudeQueryInput[] = [];
  return {
    inputs,
    queryFactory: (input) => {
      inputs.push(input);
      return handle.query;
    },
  };
}

function createStaticFallbackClaudeClient(): ClaudeAgentClient {
  const handle = createTestQuery(async () => {
    throw new Error("SDK discovery disabled for this unit test");
  });
  const { queryFactory } = createQueryFactory(handle);
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/bin/claude",
  });
}

async function createClaudeConfigDir(settings: unknown): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2));
  return configDir;
}

async function createClaudeConfigDirWithRawSettings(settings: string): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), settings);
  return configDir;
}

describe("getClaudeModels", () => {
  it("returns all claude models", () => {
    const models = getClaudeModels();
    expect(models.map((m) => m.id)).toEqual([
      "claude-fable-5[1m]",
      "claude-fable-5",
      "claude-opus-4-8[1m]",
      "claude-opus-4-8",
      "claude-opus-4-7[1m]",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("marks exactly one model as default", () => {
    const models = getClaudeModels();
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe("claude-opus-4-8");
  });

  it("gives every thinking-capable model thinking options", () => {
    const models = getClaudeModels();
    for (const model of models) {
      if (model.id.startsWith("claude-haiku")) {
        expect(model.thinkingOptions).toBeUndefined();
        continue;
      }
      expect(model.thinkingOptions?.map((option) => option.id)).toContain("max");
    }
  });

  it("gives fable models the extended thinking options including xhigh", () => {
    const models = getClaudeModels();
    const fable = models.find((m) => m.id === "claude-fable-5");
    const fable1m = models.find((m) => m.id === "claude-fable-5[1m]");
    expect(fable?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(fable1m?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("returns fresh copies each call", () => {
    const a = getClaudeModels();
    const b = getClaudeModels();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("decorateClaudeModelsWithSdkEfforts", () => {
  it("unions SDK effort levels without removing static Opus xhigh", () => {
    const models = decorateClaudeModelsWithSdkEfforts(getClaudeModels(), [
      {
        value: "claude-opus-4-8",
        displayName: "Opus",
        description: "Opus",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);

    expect(models.find((model) => model.id === "claude-opus-4-8")?.thinkingOptions).toEqual([
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ]);
  });

  it("does not decorate Haiku even if the SDK reports effort levels", () => {
    const models = decorateClaudeModelsWithSdkEfforts(getClaudeModels(), [
      {
        value: "haiku",
        displayName: "Haiku",
        description: "Haiku",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
        description: "Haiku 4.5",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);

    expect(
      models.find((model) => model.id === "claude-haiku-4-5")?.thinkingOptions,
    ).toBeUndefined();
  });

  it("matches exact normalized values before family and default fallbacks", () => {
    const models = decorateClaudeModelsWithSdkEfforts(
      [
        {
          provider: "claude",
          id: "claude-sonnet-4-6",
          label: "Sonnet",
          thinkingOptions: [{ id: "low", label: "Low" }],
        },
      ],
      [
        {
          value: "sonnet",
          displayName: "Sonnet",
          description: "Sonnet",
          supportedEffortLevels: ["medium"],
        },
        {
          value: "claude-sonnet-4-6-20260101",
          displayName: "Pinned Sonnet",
          description: "Pinned Sonnet",
          supportedEffortLevels: ["high"],
        },
      ],
    );

    expect(models[0].thinkingOptions).toEqual([
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ]);
  });

  it("matches abstract family values and strips the one-million context suffix", () => {
    const models = decorateClaudeModelsWithSdkEfforts(
      [
        {
          provider: "claude",
          id: "anthropic/claude-sonnet-4.6[1m]",
          label: "Configured Sonnet",
        },
      ],
      [
        {
          value: "sonnet",
          displayName: "Sonnet",
          description: "Sonnet",
          supportedEffortLevels: ["low", "medium"],
        },
      ],
    );

    expect(models[0].thinkingOptions).toEqual([
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
    ]);
  });

  it("does not family-match concrete SDK values into unrelated settings models", () => {
    const models = decorateClaudeModelsWithSdkEfforts(
      [
        {
          provider: "claude",
          id: "openrouter/anthropic/claude-opus-4.4",
          label: "Configured Opus",
        },
      ],
      [
        {
          value: "claude-opus-4-5-20251101",
          displayName: "Pinned Opus",
          description: "Pinned Opus",
          supportedEffortLevels: ["low", "medium"],
        },
      ],
    );

    expect(models[0].thinkingOptions).toBeUndefined();
  });

  it("uses the default SDK model only for the default static model", () => {
    const models = decorateClaudeModelsWithSdkEfforts(
      [
        { provider: "claude", id: "claude-opus-4-8", label: "Opus", isDefault: true },
        { provider: "claude", id: "claude-opus-4-7", label: "Older Opus" },
      ],
      [
        {
          value: "default",
          displayName: "Default",
          description: "Default",
          supportedEffortLevels: ["max"],
        },
      ],
    );

    expect(models[0].thinkingOptions).toEqual([{ id: "max", label: "Max" }]);
    expect(models[1].thinkingOptions).toBeUndefined();
  });

  it("keeps model thinking options unchanged when family matching is ambiguous", () => {
    const models = decorateClaudeModelsWithSdkEfforts(
      [
        {
          provider: "claude",
          id: "claude-sonnet-4-6",
          label: "Sonnet",
          thinkingOptions: [{ id: "low", label: "Low" }],
        },
        {
          provider: "claude",
          id: "openrouter/anthropic/claude-sonnet-4.4",
          label: "Configured Sonnet",
        },
      ],
      [
        {
          value: "sonnet",
          displayName: "Sonnet",
          description: "Sonnet",
          supportedEffortLevels: ["medium"],
        },
        {
          value: "SONNET",
          displayName: "Uppercase Sonnet",
          description: "Uppercase Sonnet",
          supportedEffortLevels: ["high"],
        },
      ],
    );

    expect(models[0].thinkingOptions).toEqual([{ id: "low", label: "Low" }]);
    expect(models[1].thinkingOptions).toBeUndefined();
  });
});

describe("ClaudeAgentClient.listModels", () => {
  it("decorates static and settings models with SDK effort levels", async () => {
    const configDir = await createClaudeConfigDir({
      model: "openrouter/anthropic/claude-sonnet-4.6",
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const handle = createTestQuery(async () => [
      {
        value: "default",
        displayName: "Default",
        description: "Default",
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);
    const { queryFactory, inputs } = createQueryFactory(handle);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/bin/claude",
    });

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(inputs).toHaveLength(1);
    expect(inputs[0].options).toMatchObject({
      permissionMode: "plan",
      includePartialMessages: false,
      settingSources: ["user", "project"],
      pathToClaudeCodeExecutable: "/bin/claude",
      persistSession: false,
    });
    expect(models.find((model) => model.id === "claude-opus-4-8")?.thinkingOptions).toEqual([
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ]);
    expect(
      models.find((model) => model.id === "openrouter/anthropic/claude-sonnet-4.6")
        ?.thinkingOptions,
    ).toEqual([
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "max", label: "Max" },
    ]);
    expect(handle.returnQuery).toHaveBeenCalledTimes(1);
  });

  it("does not decorate settings models below the documented Claude Code effort floor", async () => {
    const configDir = await createClaudeConfigDir({
      model: "openrouter/anthropic/claude-sonnet-4.5",
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const handle = createTestQuery(async () => [
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "haiku",
        displayName: "Haiku",
        description: "Haiku",
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);
    const { queryFactory } = createQueryFactory(handle);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/bin/claude",
    });

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(
      models.find((model) => model.id === "openrouter/anthropic/claude-sonnet-4.5")
        ?.thinkingOptions,
    ).toBeUndefined();
    expect(
      models.find((model) => model.id === "claude-haiku-4-5")?.thinkingOptions,
    ).toBeUndefined();
    expect(handle.returnQuery).toHaveBeenCalledTimes(1);
  });

  it("falls back to settings-aware static models when SDK discovery fails", async () => {
    const handle = createTestQuery(async () => {
      throw new Error("SDK discovery failed");
    });
    const { queryFactory } = createQueryFactory(handle);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/bin/claude",
    });

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models).toEqual(getClaudeModels());
    expect(handle.returnQuery).toHaveBeenCalledTimes(1);
  });

  it("falls back to settings-aware static models when SDK discovery times out", async () => {
    vi.useFakeTimers();
    const handle = createTestQuery(() => new Promise<ModelInfo[]>(() => undefined));
    const { queryFactory } = createQueryFactory(handle);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/bin/claude",
    });

    const modelsPromise = client.listModels({ cwd: os.tmpdir(), force: true });
    await vi.waitFor(() => expect(handle.supportedModels).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(modelsPromise).resolves.toEqual(getClaudeModels());
    expect(handle.returnQuery).toHaveBeenCalledTimes(1);
  });

  it("returns in-flight scratch queries during shutdown", async () => {
    vi.useFakeTimers();
    const handle = createTestQuery(() => new Promise<ModelInfo[]>(() => undefined));
    const { queryFactory } = createQueryFactory(handle);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/bin/claude",
    });

    const modelsPromise = client.listModels({ cwd: os.tmpdir(), force: true });
    await vi.waitFor(() => expect(handle.supportedModels).toHaveBeenCalledTimes(1));

    await client.shutdown();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(modelsPromise).resolves.toEqual(getClaudeModels());
    expect(handle.returnQuery).toHaveBeenCalledTimes(1);
  });

  it("appends concrete models from Claude settings.json", async () => {
    const configDir = await createClaudeConfigDir({
      model: "us.anthropic.claude-opus-4-7[1m]",
      env: {
        ANTHROPIC_MODEL: "openrouter/anthropic/claude-sonnet-4.5",
        ANTHROPIC_SMALL_FAST_MODEL: "ollama/qwen3-coder",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "bedrock-opus-from-env",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createStaticFallbackClaudeClient();

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models).toEqual([
      ...getClaudeModels(),
      {
        provider: "claude",
        id: "us.anthropic.claude-opus-4-7[1m]",
        label: "us.anthropic.claude-opus-4-7[1m]",
        description: "From Claude settings.json model",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High" },
          { id: "max", label: "Max" },
        ],
      },
      {
        provider: "claude",
        id: "openrouter/anthropic/claude-sonnet-4.5",
        label: "openrouter/anthropic/claude-sonnet-4.5",
        description: "From Claude settings.json env.ANTHROPIC_MODEL",
      },
      {
        provider: "claude",
        id: "ollama/qwen3-coder",
        label: "ollama/qwen3-coder",
        description: "From Claude settings.json env.ANTHROPIC_SMALL_FAST_MODEL",
      },
      {
        provider: "claude",
        id: "bedrock-opus-from-env",
        label: "bedrock-opus-from-env",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_OPUS_MODEL",
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ],
      },
      {
        provider: "claude",
        id: "glm-5.1",
        label: "glm-5.1",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5",
        label: "glm-5",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      },
    ]);
  });

  it("falls back to hardcoded models when settings.json is missing", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-models-"));
    createdClaudeConfigDirs.push(configDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createStaticFallbackClaudeClient();

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models).toEqual(getClaudeModels());
  });

  it("falls back to hardcoded models when settings.json is malformed", async () => {
    const configDir = await createClaudeConfigDirWithRawSettings("{ nope");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createStaticFallbackClaudeClient();

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models).toEqual(getClaudeModels());
  });

  it("ignores empty env blocks and unexpected settings shapes", async () => {
    const configDir = await createClaudeConfigDir({
      model: " ",
      env: {
        ANTHROPIC_MODEL: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: 42,
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createStaticFallbackClaudeClient();

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models).toEqual(getClaudeModels());
  });

  it("deduplicates discovered settings models by ID", async () => {
    const configDir = await createClaudeConfigDir({
      model: "glm-5.1",
      env: {
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-opus-4-6",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    const client = createStaticFallbackClaudeClient();

    const models = await client.listModels({ cwd: os.tmpdir(), force: true });

    expect(models.map((model) => model.id)).toEqual([
      ...getClaudeModels().map((model) => model.id),
      "glm-5.1",
    ]);
  });
});

describe("normalizeClaudeRuntimeModelId", () => {
  it("returns exact match for known model IDs", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("normalizes dated model IDs to base model", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-20260301")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6-20260101")).toBe("claude-opus-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-4-6-20260101")).toBe("claude-sonnet-4-6");
    expect(normalizeClaudeRuntimeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("normalizes fable model IDs with single-segment versions", () => {
    expect(normalizeClaudeRuntimeModelId("claude-fable-5")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5[1m]")).toBe("claude-fable-5[1m]");
    expect(normalizeClaudeRuntimeModelId("claude-fable-5-20260101")).toBe("claude-fable-5");
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-fable-5[1m]")).toBe(
      "claude-fable-5[1m]",
    );
  });

  it("preserves [1m] suffix from runtime model strings", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-6[1m]")).toBe("claude-opus-4-6[1m]");
  });

  it("returns null for empty/null/undefined", () => {
    expect(normalizeClaudeRuntimeModelId(null)).toBeNull();
    expect(normalizeClaudeRuntimeModelId(undefined)).toBeNull();
    expect(normalizeClaudeRuntimeModelId("")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("  ")).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizeClaudeRuntimeModelId("gpt-5")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("random")).toBeNull();
  });
});
