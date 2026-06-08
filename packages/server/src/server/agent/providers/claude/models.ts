import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition, AgentSelectOption } from "../../agent-sdk-types.js";

export type ClaudeThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";

type ClaudeModelFamily = "opus" | "sonnet" | "haiku" | "fable";

export interface ClaudeSdkModelInfo {
  value: string;
  supportedEffortLevels?: readonly unknown[];
}

interface ClaudeRuntimeModelParts {
  family: ClaudeModelFamily;
  major: string;
  /** Null for single-segment versions such as claude-fable-5. */
  minor: string | null;
  suffix: string;
}

interface ClaudeSdkEffortModel {
  value: string;
  normalizedValue: string;
  abstractFamily: ClaudeModelFamily | null;
  thinkingOptions: AgentSelectOption[];
}

const CLAUDE_THINKING_OPTION_LABELS: Record<ClaudeThinkingEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

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
    description: "Fable 5 · Most powerful model",
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

export function isClaudeThinkingEffort(
  value: string | null | undefined,
): value is ClaudeThinkingEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

const MODEL_CONTEXT_WINDOW_OVERRIDES = new Map<string, number>([["minimax-m3", 1_000_000]]);

export function getClaudeModels(): AgentModelDefinition[] {
  return CLAUDE_MODELS.map((model) => ({ ...model }));
}

export function decorateClaudeModelsWithSdkEfforts(
  models: readonly AgentModelDefinition[],
  sdkModels: readonly ClaudeSdkModelInfo[],
): AgentModelDefinition[] {
  const sdkEffortModels = buildClaudeSdkEffortModels(sdkModels);
  if (sdkEffortModels.length === 0) {
    return models.map((model) => cloneClaudeModelDefinition(model));
  }

  return models.map((model) => {
    const sdkModel = findClaudeSdkEffortModel(model, sdkEffortModels);
    if (!sdkModel) {
      return cloneClaudeModelDefinition(model);
    }

    const thinkingOptions = mergeClaudeThinkingOptions(
      model.thinkingOptions,
      sdkModel.thinkingOptions,
    );

    return {
      ...model,
      thinkingOptions,
    };
  });
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
  const versionMatch = lowered.match(/(opus|sonnet)[-_ ]+(\d+)[-.](\d{1,2})(?!\d)/);
  if (versionMatch) {
    const family = versionMatch[1];
    const major = Number(versionMatch[2]);
    const minor = Number(versionMatch[3]);
    // Claude Code documents effort support from Opus 4.6 and Sonnet 4.6 onward.
    if (major < 4 || (major === 4 && minor < 6)) {
      return null;
    }
    // Opus 4.7+ supports the extra-high effort level
    const supportsXhigh = family === "opus" && (major > 4 || minor >= 7);
    return supportsXhigh ? [...CLAUDE_EXTENDED_THINKING_OPTIONS] : [...CLAUDE_THINKING_OPTIONS];
  }
  if (lowered.includes("opus") || lowered.includes("sonnet")) {
    return [...CLAUDE_THINKING_OPTIONS];
  }
  return null;
}

function cloneClaudeModelDefinition(model: AgentModelDefinition): AgentModelDefinition {
  return {
    ...model,
    thinkingOptions: model.thinkingOptions?.map((option) => ({ ...option })),
  };
}

function buildClaudeSdkEffortModels(
  sdkModels: readonly ClaudeSdkModelInfo[],
): ClaudeSdkEffortModel[] {
  const effortModels: ClaudeSdkEffortModel[] = [];

  for (const sdkModel of sdkModels) {
    const thinkingOptions = buildClaudeSdkThinkingOptions(sdkModel.supportedEffortLevels);
    if (thinkingOptions.length === 0) {
      continue;
    }

    const value = sdkModel.value.trim();
    if (value.length === 0) {
      continue;
    }

    const normalizedValue = normalizeClaudeSdkModelValue(value);
    effortModels.push({
      value,
      normalizedValue,
      abstractFamily: getClaudeAbstractModelFamily(normalizedValue),
      thinkingOptions,
    });
  }

  return effortModels;
}

function buildClaudeSdkThinkingOptions(
  supportedEffortLevels: readonly unknown[] | undefined,
): AgentSelectOption[] {
  if (!Array.isArray(supportedEffortLevels)) {
    return [];
  }

  const thinkingOptions: AgentSelectOption[] = [];
  const seenIds = new Set<ClaudeThinkingEffort>();
  for (const effort of supportedEffortLevels) {
    if (typeof effort !== "string" || !isClaudeThinkingEffort(effort) || seenIds.has(effort)) {
      continue;
    }

    seenIds.add(effort);
    thinkingOptions.push({
      id: effort,
      label: CLAUDE_THINKING_OPTION_LABELS[effort],
    });
  }

  return thinkingOptions;
}

function findClaudeSdkEffortModel(
  model: AgentModelDefinition,
  sdkEffortModels: readonly ClaudeSdkEffortModel[],
): ClaudeSdkEffortModel | null {
  if (!isClaudeCodeEffortCapableModel(model.id)) {
    return null;
  }

  const normalizedModelId = normalizeClaudeSdkModelValue(model.id);
  const exactMatches = sdkEffortModels.filter(
    (sdkModel) => sdkModel.normalizedValue === normalizedModelId,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    return null;
  }

  const modelFamily = getClaudeModelFamily(model.id);
  if (modelFamily) {
    const familyMatches = sdkEffortModels.filter(
      (sdkModel) => sdkModel.abstractFamily === modelFamily,
    );
    if (familyMatches.length === 1) {
      return familyMatches[0];
    }
    if (familyMatches.length > 1) {
      return null;
    }
  }

  if (model.isDefault === true) {
    const defaultMatches = sdkEffortModels.filter(
      (sdkModel) => sdkModel.normalizedValue === "default",
    );
    if (defaultMatches.length === 1) {
      return defaultMatches[0];
    }
  }

  return null;
}

function mergeClaudeThinkingOptions(
  staticOptions: readonly AgentSelectOption[] | undefined,
  sdkOptions: readonly AgentSelectOption[],
): AgentSelectOption[] | undefined {
  const optionsById = new Map<string, AgentSelectOption>();
  for (const option of staticOptions ?? []) {
    optionsById.set(option.id, { ...option });
  }
  for (const option of sdkOptions) {
    if (!optionsById.has(option.id)) {
      optionsById.set(option.id, { ...option });
    }
  }

  const thinkingOptions = Array.from(optionsById.values());
  return thinkingOptions.length > 0 ? thinkingOptions : undefined;
}

function normalizeClaudeSdkModelValue(value: string): string {
  return normalizeClaudeRuntimeModelId(value) ?? value.trim().toLowerCase();
}

function getClaudeModelFamily(value: string): ClaudeModelFamily | null {
  const normalizedValue = normalizeClaudeSdkModelValue(value);
  const abstractFamily = getClaudeAbstractModelFamily(normalizedValue);
  if (abstractFamily) return abstractFamily;

  if (normalizedValue.startsWith("claude-opus-")) {
    return "opus";
  }
  if (normalizedValue.startsWith("claude-sonnet-")) {
    return "sonnet";
  }
  if (normalizedValue.startsWith("claude-haiku-")) {
    return "haiku";
  }
  if (normalizedValue.startsWith("claude-fable-")) {
    return "fable";
  }

  return null;
}

function getClaudeAbstractModelFamily(normalizedValue: string): ClaudeModelFamily | null {
  if (
    normalizedValue === "opus" ||
    normalizedValue === "sonnet" ||
    normalizedValue === "haiku" ||
    normalizedValue === "fable"
  ) {
    return normalizedValue;
  }

  return null;
}

function isClaudeCodeEffortCapableModel(value: string): boolean {
  const normalizedValue = normalizeClaudeSdkModelValue(value);
  const abstractFamily = getClaudeAbstractModelFamily(normalizedValue);
  if (abstractFamily) {
    return abstractFamily !== "haiku";
  }

  const runtimeModel = parseClaudeRuntimeModelId(normalizedValue);
  if (!runtimeModel) {
    return false;
  }

  if (runtimeModel.family === "haiku") {
    return false;
  }
  if (runtimeModel.family === "fable") {
    return true;
  }

  // Claude Code documents effort support from Opus 4.6 and Sonnet 4.6 onward.
  return compareClaudeRuntimeModelVersion(runtimeModel, 4, 6) >= 0;
}

function compareClaudeRuntimeModelVersion(
  model: ClaudeRuntimeModelParts,
  major: number,
  minor: number,
): number {
  const modelMajor = Number(model.major);
  const modelMinor = model.minor === null ? 0 : Number(model.minor);
  if (modelMajor !== major) {
    return modelMajor - major;
  }

  return modelMinor - minor;
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

  const runtimeMatch = parseClaudeRuntimeModelId(trimmed);
  if (!runtimeMatch) {
    return null;
  }

  const minorSegment = runtimeMatch.minor === null ? "" : `-${runtimeMatch.minor}`;
  return `claude-${runtimeMatch.family}-${runtimeMatch.major}${minorSegment}${runtimeMatch.suffix}`;
}

function parseClaudeRuntimeModelId(value: string): ClaudeRuntimeModelParts | null {
  // Match: claude-{family}-{major}[-{minor}][1m]? possibly followed by a date suffix.
  // The minor segment is capped at 2 digits so an 8-digit date suffix (e.g.
  // claude-fable-5-20260101) is not mistaken for a minor version.
  const runtimeMatch = value.match(
    /(?:claude-)?(opus|sonnet|haiku|fable)[-_ ]+(\d+)(?:[-.](\d{1,2})(?!\d))?(\[1m\])?/i,
  );
  if (!runtimeMatch) {
    return null;
  }

  return {
    family: runtimeMatch[1].toLowerCase() as ClaudeModelFamily,
    major: runtimeMatch[2],
    minor: runtimeMatch[3] ?? null,
    suffix: runtimeMatch[4] ?? "",
  };
}

export function resolveClaudeModelContextWindowOverride(
  modelId: string | null | undefined,
): number | undefined {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) {
    return undefined;
  }

  if (/\[1m\]$/i.test(trimmed)) {
    return 1_000_000;
  }

  return MODEL_CONTEXT_WINDOW_OVERRIDES.get(trimmed.toLowerCase());
}
