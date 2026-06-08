import type { AgentFeature, AgentProvider } from "./agent-sdk-types.js";

export interface ValidateAgentFeatureValuesOptions {
  provider: AgentProvider;
}

export function validateAgentFeatureValues(
  values: Record<string, unknown>,
  features: AgentFeature[],
  options: ValidateAgentFeatureValuesOptions,
): Record<string, unknown> {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const validated: Record<string, unknown> = {};

  for (const [featureId, value] of Object.entries(values)) {
    const feature = featureById.get(featureId);
    if (!feature) {
      throw new Error(
        `Unknown feature '${featureId}' for provider '${options.provider}'. Available features: ${formatFeatureIds(features)}`,
      );
    }

    if (feature.type === "toggle") {
      if (typeof value !== "boolean") {
        throw new Error(
          `Feature '${featureId}' for provider '${options.provider}' expects a boolean value`,
        );
      }
      validated[featureId] = value;
      continue;
    }

    if (value !== null && typeof value !== "string") {
      throw new Error(
        `Feature '${featureId}' for provider '${options.provider}' expects one of: ${formatSelectOptions(feature)}`,
      );
    }

    if (value !== null && !feature.options.some((option) => option.id === value)) {
      throw new Error(
        `Invalid value '${value}' for feature '${featureId}' on provider '${options.provider}'. Available values: ${formatSelectOptions(feature)}`,
      );
    }

    validated[featureId] = value;
  }

  return validated;
}

function formatFeatureIds(features: AgentFeature[]): string {
  if (features.length === 0) {
    return "(none)";
  }
  return features.map((feature) => feature.id).join(", ");
}

function formatSelectOptions(feature: Extract<AgentFeature, { type: "select" }>): string {
  return feature.options.map((option) => option.id).join(", ") || "(none)";
}
