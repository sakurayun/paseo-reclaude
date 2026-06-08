import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import type { Command } from "commander";

import type { CommandError, CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";
import {
  formatFeatureOptions,
  formatFeatureValue,
  hasFeatureValues,
  parseFeatureFlagValues,
  validateFeatureValuesForFeatures,
} from "../../utils/provider-features.js";
import { resolveProviderAndModel } from "../../utils/provider-model.js";

export interface ProviderFeatureListItem {
  id: string;
  label: string;
  type: AgentFeature["type"];
  value: string;
  options: string;
  description: string;
}

export const providerFeaturesSchema: OutputSchema<ProviderFeatureListItem> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 24 },
    { header: "LABEL", field: "label", width: 24 },
    { header: "TYPE", field: "type", width: 10 },
    { header: "VALUE", field: "value", width: 12 },
    { header: "OPTIONS", field: "options", width: 28 },
    { header: "DESCRIPTION", field: "description", width: 40 },
  ],
};

export type ProviderFeaturesResult = ListResult<ProviderFeatureListItem>;

export interface ProviderFeaturesOptions extends CommandOptions {
  host?: string;
  model?: string;
  mode?: string;
  thinking?: string;
  cwd?: string;
  feature?: string[];
}

export async function runFeaturesCommand(
  provider: string,
  options: ProviderFeaturesOptions,
  _command: Command,
): Promise<ProviderFeaturesResult> {
  const resolved = resolveProviderAndModel({ provider, model: options.model });
  const cwd = options.cwd ?? process.cwd();
  const featureValues = parseFeatureFlagValues(options.feature);
  const client = await connectToDaemon({ host: options.host });
  try {
    const result = await client.listProviderFeatures({
      provider: resolved.provider,
      cwd,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(options.mode ? { modeId: options.mode } : {}),
      ...(options.thinking ? { thinkingOptionId: options.thinking } : {}),
      ...(hasFeatureValues(featureValues) ? { featureValues } : {}),
    });

    if (result.error) {
      throw {
        code: "PROVIDER_ERROR",
        message: `Failed to fetch features for ${resolved.provider}: ${result.error}`,
      } satisfies CommandError;
    }

    const features = result.features ?? [];
    if (hasFeatureValues(featureValues)) {
      validateFeatureValuesForFeatures(featureValues, features, { source: "--feature" });
    }

    return {
      type: "list",
      data: features.map(toProviderFeatureListItem),
      schema: providerFeaturesSchema,
    };
  } finally {
    await client.close();
  }
}

function toProviderFeatureListItem(feature: AgentFeature): ProviderFeatureListItem {
  return {
    id: feature.id,
    label: feature.label,
    type: feature.type,
    value: formatFeatureValue(feature.value),
    options: formatFeatureOptions(feature),
    description: feature.description ?? feature.tooltip ?? "",
  };
}
