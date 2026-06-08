import type { AgentFeature, AgentFeatureToggle } from "../../agent-sdk-types.js";
import { normalizeClaudeRuntimeModelId } from "./models.js";

const CLAUDE_FAST_MODE_SUPPORTED_MODEL_PREFIXES = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
] as const;
const CLAUDE_FAST_MODE_SUPPORTED_MODEL_ALIASES = ["opus"] as const;

const CLAUDE_ULTRACODE_SUPPORTED_MODEL_PREFIXES = ["claude-opus-4-8", "claude-opus-4-7"] as const;
const CLAUDE_ULTRACODE_SUPPORTED_MODEL_ALIASES = ["opus"] as const;

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency Opus responses at higher token cost",
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

function normalizeClaudeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalizeClaudeRuntimeModelId(normalized) ?? normalized;
}

function modelIdMatchesPrefix(modelId: string, prefix: string): boolean {
  return modelId === prefix || modelId.startsWith(`${prefix}[`);
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

export function buildClaudeFeatures(input: {
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
  ultracodeEnabled: boolean;
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

  return features;
}
