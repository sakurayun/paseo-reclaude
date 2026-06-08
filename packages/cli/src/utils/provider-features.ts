import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import type { CommandError } from "../output/index.js";

export interface FeatureValidationOptions {
  source: string;
}

export function parseFeatureFlagValues(flags: string[] | undefined): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const rawFlag of flags ?? []) {
    const raw = rawFlag.trim();
    if (!raw) {
      throw invalidFeatureFlag(rawFlag, "Feature flags must include a non-empty feature id");
    }

    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      values[raw] = true;
      continue;
    }

    const id = raw.slice(0, eqIndex).trim();
    const rawValue = raw.slice(eqIndex + 1).trim();
    if (!id) {
      throw invalidFeatureFlag(rawFlag, "Feature flags must include a non-empty feature id");
    }
    if (!rawValue) {
      throw invalidFeatureFlag(rawFlag, "Feature flags with '=' must include a non-empty value");
    }

    values[id] = parseSingleFeatureValue(rawValue);
  }
  return values;
}

export function parseSingleFeatureValue(rawValue: string | undefined): unknown {
  if (rawValue === undefined) {
    return true;
  }
  const value = rawValue.trim();
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  return value;
}

export function validateFeatureValuesForFeatures(
  values: Record<string, unknown>,
  features: AgentFeature[],
  options: FeatureValidationOptions,
): Record<string, unknown> {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const validated: Record<string, unknown> = {};

  for (const [id, value] of Object.entries(values)) {
    const feature = featureById.get(id);
    if (!feature) {
      throw {
        code: "INVALID_FEATURE",
        message: `Unknown provider feature: ${id}`,
        details: buildAvailableFeaturesDetails(options.source, features),
      } satisfies CommandError;
    }

    if (feature.type === "toggle") {
      if (typeof value !== "boolean") {
        throw {
          code: "INVALID_FEATURE_VALUE",
          message: `Provider feature ${id} expects a boolean value`,
          details: `Use ${options.source} ${id}=true or ${options.source} ${id}=false`,
        } satisfies CommandError;
      }
      validated[id] = value;
      continue;
    }

    if (typeof value !== "string") {
      throw {
        code: "INVALID_FEATURE_VALUE",
        message: `Provider feature ${id} expects one of: ${formatFeatureOptions(feature)}`,
        details: `Use ${options.source} ${id}=<option>`,
      } satisfies CommandError;
    }

    const optionIds = new Set(feature.options.map((option) => option.id));
    if (!optionIds.has(value)) {
      throw {
        code: "INVALID_FEATURE_VALUE",
        message: `Invalid value for provider feature ${id}: ${value}`,
        details: `Available values: ${formatFeatureOptions(feature)}`,
      } satisfies CommandError;
    }
    validated[id] = value;
  }

  return validated;
}

export function formatFeatureValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "none";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function formatFeatureOptions(feature: AgentFeature): string {
  if (feature.type === "toggle") {
    return "true, false";
  }
  return feature.options.map((option) => option.id).join(", ") || "none";
}

export function hasFeatureValues(values: Record<string, unknown>): boolean {
  return Object.keys(values).length > 0;
}

function invalidFeatureFlag(rawFlag: string, message: string): CommandError {
  return {
    code: "INVALID_FEATURE",
    message: `Invalid provider feature flag: ${rawFlag} (${message})`,
    details: `${message}. Use --feature <id> or --feature <id=value>.`,
  };
}

function buildAvailableFeaturesDetails(source: string, features: AgentFeature[]): string {
  if (features.length === 0) {
    return "This provider/model does not advertise configurable features.";
  }
  const formatted = features
    .map((feature) => `${feature.id} (${formatFeatureOptions(feature)})`)
    .join(", ");
  return `Available features for ${source}: ${formatted}`;
}
