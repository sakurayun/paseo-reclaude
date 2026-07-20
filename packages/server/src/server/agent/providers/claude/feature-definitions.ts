import type {
  AgentFeature,
  AgentFeatureSelect,
  AgentFeatureToggle,
  AgentSelectOption,
} from "../../agent-sdk-types.js";
import { normalizeClaudeRuntimeModelId } from "./models.js";

const CLAUDE_FAST_MODE_SUPPORTED_MODEL_PREFIXES = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
] as const;
const CLAUDE_FAST_MODE_SUPPORTED_MODEL_ALIASES = ["opus"] as const;

const CLAUDE_ULTRACODE_SUPPORTED_MODEL_PREFIXES = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
] as const;
const CLAUDE_ULTRACODE_SUPPORTED_MODEL_ALIASES = ["opus"] as const;

/** Claude Code public aliases that can host the experimental server-side advisor tool. */
const CLAUDE_ADVISOR_BASE_MODEL_PREFIXES = [
  "claude-fable-5",
  "claude-opus-4",
  "claude-sonnet-4",
] as const;
const CLAUDE_ADVISOR_BASE_MODEL_ALIASES = ["fable", "opus", "sonnet"] as const;

export const CLAUDE_ADVISOR_FEATURE_ID = "advisor";
export const CLAUDE_ADVISOR_OFF_OPTION_ID = "off";
export const CLAUDE_ADVISOR_EXPERIMENTAL_ENV = "CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL";

/**
 * Advisor model options ordered by capability rank. Claude requires the advisor
 * model to be at least as capable as the executor (base) model.
 */
const CLAUDE_ADVISOR_MODEL_OPTIONS = [
  { id: "sonnet", label: "Sonnet", rank: 1 },
  { id: "opus", label: "Opus", rank: 2 },
  { id: "fable", label: "Fable", rank: 2 },
] as const;

export type ClaudeAdvisorModelOptionId = (typeof CLAUDE_ADVISOR_MODEL_OPTIONS)[number]["id"];
export type ClaudeAdvisorFeatureValue =
  | typeof CLAUDE_ADVISOR_OFF_OPTION_ID
  | ClaudeAdvisorModelOptionId;

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export const CLAUDE_ULTRACODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "ultracode",
  label: "Ultracode",
  description: "Use xhigh effort with Claude's dynamic workflow orchestration",
  tooltip: "Toggle Ultracode",
  icon: "sparkles",
};

export const CLAUDE_ADVISOR_FEATURE: Omit<AgentFeatureSelect, "value" | "options"> = {
  type: "select",
  id: CLAUDE_ADVISOR_FEATURE_ID,
  label: "Advisor",
  description:
    "Enable Claude's experimental server-side advisor tool (uses a second model for guidance)",
  tooltip: "Choose advisor model",
  icon: "message-circle",
};

function normalizeClaudeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalizeClaudeRuntimeModelId(normalized) ?? normalized;
}

function modelIdMatchesPrefix(modelId: string, prefix: string): boolean {
  return modelId === prefix || modelId.startsWith(`${prefix}[`) || modelId.startsWith(`${prefix}-`);
}

function modelIdMatchesAlias(modelId: string, aliases: readonly string[]): boolean {
  return aliases.includes(modelId);
}

export function claudeModelSupportsFastMode(modelId: string | null | undefined): boolean {
  const normalizedModelId = normalizeClaudeModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }

  if (modelIdMatchesAlias(normalizedModelId, CLAUDE_FAST_MODE_SUPPORTED_MODEL_ALIASES)) {
    return true;
  }

  return CLAUDE_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some((prefix) =>
    modelIdMatchesPrefix(normalizedModelId, prefix),
  );
}

export function claudeModelSupportsUltracode(modelId: string | null | undefined): boolean {
  const normalizedModelId = normalizeClaudeModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }

  if (modelIdMatchesAlias(normalizedModelId, CLAUDE_ULTRACODE_SUPPORTED_MODEL_ALIASES)) {
    return true;
  }

  return CLAUDE_ULTRACODE_SUPPORTED_MODEL_PREFIXES.some((prefix) =>
    modelIdMatchesPrefix(normalizedModelId, prefix),
  );
}

export function claudeModelSupportsAdvisor(modelId: string | null | undefined): boolean {
  return resolveClaudeAdvisorCapabilityRank(modelId) !== null;
}

export function resolveClaudeAdvisorCapabilityRank(
  modelId: string | null | undefined,
): number | null {
  const normalizedModelId = normalizeClaudeModelId(modelId);
  if (!normalizedModelId) {
    return null;
  }

  if (
    modelIdMatchesAlias(normalizedModelId, ["fable"]) ||
    modelIdMatchesPrefix(normalizedModelId, "claude-fable")
  ) {
    return 2;
  }
  if (
    modelIdMatchesAlias(normalizedModelId, ["opus"]) ||
    modelIdMatchesPrefix(normalizedModelId, "claude-opus")
  ) {
    return 2;
  }
  if (
    modelIdMatchesAlias(normalizedModelId, ["sonnet"]) ||
    modelIdMatchesPrefix(normalizedModelId, "claude-sonnet")
  ) {
    return 1;
  }

  // Allow experimental opt-in on unrecognized public Claude IDs only when they
  // still look like Claude models (avoids offering advisor on non-Claude gateways).
  if (
    CLAUDE_ADVISOR_BASE_MODEL_PREFIXES.some((prefix) =>
      modelIdMatchesPrefix(normalizedModelId, prefix),
    ) ||
    modelIdMatchesAlias(normalizedModelId, CLAUDE_ADVISOR_BASE_MODEL_ALIASES)
  ) {
    return 1;
  }

  return null;
}

export function isClaudeAdvisorModelOptionId(value: string): value is ClaudeAdvisorModelOptionId {
  return CLAUDE_ADVISOR_MODEL_OPTIONS.some((option) => option.id === value);
}

export function normalizeClaudeAdvisorFeatureValue(
  value: unknown,
): ClaudeAdvisorFeatureValue | null {
  if (value === null || value === undefined) {
    return CLAUDE_ADVISOR_OFF_OPTION_ID;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === CLAUDE_ADVISOR_OFF_OPTION_ID) {
    return CLAUDE_ADVISOR_OFF_OPTION_ID;
  }
  if (isClaudeAdvisorModelOptionId(trimmed)) {
    return trimmed;
  }
  return null;
}

export function listClaudeAdvisorModelOptionsForBase(
  modelId: string | null | undefined,
): AgentSelectOption[] {
  const baseRank = resolveClaudeAdvisorCapabilityRank(modelId);
  if (baseRank === null) {
    return [];
  }

  return CLAUDE_ADVISOR_MODEL_OPTIONS.filter((option) => option.rank >= baseRank).map((option) => ({
    id: option.id,
    label: option.label,
  }));
}

export function isClaudeAdvisorPairingValid(input: {
  baseModelId: string | null | undefined;
  advisorModelId: string | null | undefined;
}): boolean {
  const advisor = normalizeClaudeAdvisorFeatureValue(input.advisorModelId);
  if (!advisor || advisor === CLAUDE_ADVISOR_OFF_OPTION_ID) {
    return true;
  }
  const baseRank = resolveClaudeAdvisorCapabilityRank(input.baseModelId);
  if (baseRank === null) {
    return false;
  }
  const advisorOption = CLAUDE_ADVISOR_MODEL_OPTIONS.find((option) => option.id === advisor);
  if (!advisorOption) {
    return false;
  }
  return advisorOption.rank >= baseRank;
}

export function isClaudeAdvisorFeatureEnabled(value: unknown): boolean {
  const normalized = normalizeClaudeAdvisorFeatureValue(value);
  return Boolean(normalized && normalized !== CLAUDE_ADVISOR_OFF_OPTION_ID);
}

export function buildClaudeFeatures(input: {
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
  ultracodeEnabled: boolean;
  advisorModel?: unknown;
}): AgentFeature[] {
  const features: AgentFeature[] = [];

  if (claudeModelSupportsFastMode(input.modelId)) {
    features.push({
      ...CLAUDE_FAST_MODE_FEATURE,
      value: input.fastModeEnabled,
    });
  }

  if (claudeModelSupportsUltracode(input.modelId)) {
    features.push({
      ...CLAUDE_ULTRACODE_FEATURE,
      value: input.ultracodeEnabled,
    });
  }

  if (claudeModelSupportsAdvisor(input.modelId)) {
    const advisorOptions = listClaudeAdvisorModelOptionsForBase(input.modelId);
    const requested =
      normalizeClaudeAdvisorFeatureValue(input.advisorModel) ?? CLAUDE_ADVISOR_OFF_OPTION_ID;
    const value =
      requested !== CLAUDE_ADVISOR_OFF_OPTION_ID &&
      advisorOptions.some((option) => option.id === requested) &&
      isClaudeAdvisorPairingValid({ baseModelId: input.modelId, advisorModelId: requested })
        ? requested
        : CLAUDE_ADVISOR_OFF_OPTION_ID;

    features.push({
      ...CLAUDE_ADVISOR_FEATURE,
      value,
      options: [{ id: CLAUDE_ADVISOR_OFF_OPTION_ID, label: "Off" }, ...advisorOptions],
    });
  }

  return features;
}
