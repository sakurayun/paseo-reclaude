import type { AgentFeature, AgentModelDefinition } from "@server/server/agent/agent-sdk-types";

export type ExplainedStatusSelector = "gateway" | "mode" | "model" | "thinking";
export type ExplainedAgentControl = ExplainedStatusSelector;
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";

export function getStatusSelectorHint(selector: ExplainedStatusSelector): string {
  switch (selector) {
    case "gateway":
      return "Model gateway";
    case "thinking":
      return "Thinking mode";
    case "model":
      return "Change model";
    case "mode":
      return "Change permission mode";
    default:
      throw new Error("unreachable");
  }
}

export const getAgentControlHint = getStatusSelectorHint;

interface ControlLabelInput {
  id: string;
  label?: string;
}

const SEPARATOR_PATTERN = /[-_\s]+/g;

function splitCompactLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(SEPARATOR_PATTERN, " ")
    .trim();
}

function sentenceCase(value: string): string {
  const compact = splitCompactLabel(value);
  if (!compact) {
    return value;
  }
  const lower = compact.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatControlLabel(option: ControlLabelInput, preserveHyphenatedLabel: boolean): string {
  const label = option.label ?? option.id;
  if (label.toLowerCase() === "xhigh") {
    return "Extra high";
  }
  if (preserveHyphenatedLabel && option.label?.includes("-") && !option.label.includes("_")) {
    const lower = option.label.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return sentenceCase(label);
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, true);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  return formatControlLabel(option, false);
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? "Unknown model",
  };
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = effectiveThinking
    ? formatThinkingOptionLabel(effectiveThinking)
    : (selectedThinkingId ?? "Unknown");

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
