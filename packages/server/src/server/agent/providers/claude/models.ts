import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";

const CLAUDE_THINKING_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
] as const;

const CLAUDE_EXTENDED_THINKING_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
] as const;

const CLAUDE_MODELS: AgentModelDefinition[] = [
  {
    provider: "claude",
    id: "claude-fable-5[1m]",
    label: "Fable 5 1M",
    description: "Fable 5 with 1M context window",
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-fable-5",
    label: "Fable 5",
    description: "Fable 5 · Newest model",
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-8[1m]",
    label: "Opus 4.8 1M",
    description: "Opus 4.8 with 1M context window",
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    description: "Opus 4.8 · Latest release",
    isDefault: true,
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-7[1m]",
    label: "Opus 4.7 1M",
    description: "Opus 4.7 with 1M context window",
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Opus 4.7 · Previous release",
    thinkingOptions: [...CLAUDE_EXTENDED_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-6[1m]",
    label: "Opus 4.6 1M",
    description: "Opus 4.6 with 1M context window",
    thinkingOptions: [...CLAUDE_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Opus 4.6 · Most capable for complex work",
    thinkingOptions: [...CLAUDE_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-sonnet-4-6[1m]",
    label: "Sonnet 4.6 1M",
    description: "Sonnet 4.6 with 1M context window",
    thinkingOptions: [...CLAUDE_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Sonnet 4.6 · Best for everyday tasks",
    thinkingOptions: [...CLAUDE_THINKING_OPTIONS],
  },
  {
    provider: "claude",
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

export function getClaudeModels(): AgentModelDefinition[] {
  return CLAUDE_MODELS.map((model) => ({ ...model }));
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir?: string,
): Promise<AgentModelDefinition[]> {
  const hardcodedModels = getClaudeModels();
  const settingsModels = await readClaudeSettingsModels(logger, configDir);
  if (settingsModels.length === 0) {
    return hardcodedModels;
  }

  const seenModelIds = new Set(hardcodedModels.map((model) => model.id));
  const models = [...hardcodedModels];

  for (const model of settingsModels) {
    if (seenModelIds.has(model.id)) {
      continue;
    }
    seenModelIds.add(model.id);
    models.push(model);
  }

  return models;
}

async function readClaudeSettingsModels(
  logger: Logger,
  configDir?: string,
): Promise<AgentModelDefinition[]> {
  const settingsPath = path.join(resolveClaudeConfigDir(configDir), "settings.json");

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return [];
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return [];
  }

  const models: AgentModelDefinition[] = [];
  addSettingsModel(models, parsed.model, "model");

  const env = parsed.env;
  if (env === undefined) {
    return models;
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return models;
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel(models, env[envKey], `env.${envKey}`);
  }

  return models;
}

function resolveClaudeConfigDir(configDir?: string): string {
  return configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  const thinkingOptions = inferClaudeThinkingOptions(id);
  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
    ...(thinkingOptions ? { thinkingOptions } : {}),
  });
}

/**
 * Infer thinking options for Claude model IDs discovered outside the hardcoded
 * list (settings.json, env overrides). Any model from a thinking-capable
 * family gets the selector; unknown/non-Anthropic IDs get none.
 */
function inferClaudeThinkingOptions(
  modelId: string,
): AgentModelDefinition["thinkingOptions"] | null {
  const lowered = modelId.toLowerCase();
  if (lowered.includes("fable")) {
    return [...CLAUDE_EXTENDED_THINKING_OPTIONS];
  }
  const opusMatch = lowered.match(/opus[-_ ]+(\d+)[-.](\d+)/);
  if (opusMatch) {
    const major = Number(opusMatch[1]);
    const minor = Number(opusMatch[2]);
    // Opus 4.7+ supports the extra-high effort level
    const supportsXhigh = major > 4 || (major === 4 && minor >= 7);
    return supportsXhigh ? [...CLAUDE_EXTENDED_THINKING_OPTIONS] : [...CLAUDE_THINKING_OPTIONS];
  }
  if (lowered.includes("opus") || lowered.includes("sonnet")) {
    return [...CLAUDE_THINKING_OPTIONS];
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  // Check for exact match first (handles claude-opus-4-6[1m] directly)
  if (CLAUDE_MODELS.some((model) => model.id === trimmed)) {
    return trimmed;
  }

  // Match: claude-{family}-{major}[-{minor}][1m]? possibly followed by a date suffix.
  // The minor segment is capped at 2 digits so an 8-digit date suffix (e.g.
  // claude-fable-5-20260101) is not mistaken for a minor version.
  const runtimeMatch = trimmed.match(
    /(?:claude-)?(opus|sonnet|haiku|fable)[-_ ]+(\d+)(?:[-.](\d{1,2})(?!\d))?(\[1m\])?/i,
  );
  if (!runtimeMatch) {
    return null;
  }

  const family = runtimeMatch[1].toLowerCase();
  const major = runtimeMatch[2];
  const minor = runtimeMatch[3];
  const suffix = runtimeMatch[4] ?? "";
  return `claude-${family}-${major}${minor ? `-${minor}` : ""}${suffix}`;
}
