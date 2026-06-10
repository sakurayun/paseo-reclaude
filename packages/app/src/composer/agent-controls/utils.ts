import type { TFunction } from "i18next";

import type { AgentFeature, AgentModelDefinition } from "@getpaseo/protocol/agent-types";

const CLAUDE_ULTRACODE_FEATURE_ID = "ultracode";
const CLAUDE_ULTRACODE_THINKING_OPTION_ID = "xhigh";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "purple" | "yellow";

export function getAgentControlHint(
  selector: ExplainedAgentControl,
  t?: TFunction<"composer">,
): string {
  switch (selector) {
    case "thinking":
      return t ? t("controls.hints.thinking") : "Thinking mode";
    case "model":
      return t ? t("controls.hints.model") : "Change model";
    case "mode":
      return t ? t("controls.hints.mode") : "Change permission mode";
    default:
      throw new Error("unreachable");
  }
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
    case CLAUDE_ULTRACODE_FEATURE_ID:
      return "purple";
    case "auto_accept":
      return "green";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

export function resolveFeatureImpliedThinkingOptionId(input: {
  featureId: string;
  value: unknown;
  thinkingOptions: readonly { id: string }[] | undefined;
}): string | null {
  if (input.featureId !== CLAUDE_ULTRACODE_FEATURE_ID || input.value !== true) {
    return null;
  }
  const hasXhigh = input.thinkingOptions?.some(
    (option) => option.id === CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  );
  return hasXhigh ? CLAUDE_ULTRACODE_THINKING_OPTION_ID : null;
}

export function resolveThinkingImpliedFeatureUpdates(input: {
  thinkingOptionId: string;
  features: readonly AgentFeature[] | undefined;
}): Array<{ featureId: string; value: boolean }> {
  if (input.thinkingOptionId === CLAUDE_ULTRACODE_THINKING_OPTION_ID) {
    return [];
  }

  const ultracodeFeature = input.features?.find(
    (feature) => feature.type === "toggle" && feature.id === CLAUDE_ULTRACODE_FEATURE_ID,
  );
  if (!ultracodeFeature || ultracodeFeature.type !== "toggle" || !ultracodeFeature.value) {
    return [];
  }

  return [{ featureId: CLAUDE_ULTRACODE_FEATURE_ID, value: false }];
}

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactId === "xhigh" || compactLabel === "xhigh") {
    return "Extra high";
  }

  return formatControlLabel(option, true);
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
  t?: TFunction<"composer">,
): { activeModelId: string | null; displayModel: string } {
  const unknownModelLabel = t ? t("controls.model.unknownLabel") : "Unknown model";
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  t?: TFunction<"composer">,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return t ? t("controls.thinking.unknownLabel") : "Unknown";
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
  t?: TFunction<"composer">;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId, t } = input;
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
    t,
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = resolveThinkingDisplay(effectiveThinking, selectedThinkingId, t);

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
