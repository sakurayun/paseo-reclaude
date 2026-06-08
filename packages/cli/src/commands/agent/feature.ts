import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import type { Command } from "commander";

import type {
  AnyCommandResult,
  CommandError,
  CommandOptions,
  OutputSchema,
} from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import {
  formatFeatureOptions,
  formatFeatureValue,
  parseSingleFeatureValue,
  validateFeatureValuesForFeatures,
} from "../../utils/provider-features.js";

export interface AgentFeatureListItem {
  id: string;
  label: string;
  type: AgentFeature["type"];
  value: string;
  options: string;
  description: string;
}

export interface AgentFeatureSetResult {
  agentId: string;
  feature: string;
  value: string;
}

export const agentFeatureListSchema: OutputSchema<AgentFeatureListItem> = {
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

export const setAgentFeatureSchema: OutputSchema<AgentFeatureSetResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId", width: 12 },
    { header: "FEATURE", field: "feature", width: 24 },
    { header: "VALUE", field: "value", width: 12 },
  ],
};

export interface AgentFeatureOptions extends CommandOptions {
  host?: string;
  list?: boolean;
}

// This command returns two different data shapes (set result vs feature list).
// Keep `any` here to match the existing output wrapper generic contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentFeatureCommandResult = AnyCommandResult<any>;

export async function runAgentFeatureCommand(
  id: string,
  featureId: string | undefined,
  value: string | undefined,
  options: AgentFeatureOptions,
  _command: Command,
): Promise<AgentFeatureCommandResult> {
  const host = getDaemonHost({ host: options.host });
  const normalizedFeatureId = featureId?.trim();

  if (!options.list && !normalizedFeatureId) {
    throw missingFeatureError();
  }

  let client: Awaited<ReturnType<typeof connectToDaemon>> | undefined;
  try {
    client = await connectToDaemon({ host: options.host });
    const fetchResult = await client.fetchAgent(id);
    if (!fetchResult) {
      throw {
        code: "AGENT_NOT_FOUND",
        message: `No agent found matching: ${id}`,
        details: "Use `paseo ls` to list available agents",
      } satisfies CommandError;
    }

    const agent = fetchResult.agent;
    const features = agent.features ?? [];

    if (options.list) {
      return {
        type: "list",
        data: features.map(toAgentFeatureListItem),
        schema: agentFeatureListSchema,
      };
    }

    if (!normalizedFeatureId) {
      throw missingFeatureError();
    }

    const parsedValue = parseSingleFeatureValue(value);
    const validated = validateFeatureValuesForFeatures(
      { [normalizedFeatureId]: parsedValue },
      features,
      { source: "paseo agent feature" },
    );

    await client.setAgentFeature(agent.id, normalizedFeatureId, validated[normalizedFeatureId]);

    const updatedResult = await client.fetchAgent(agent.id);
    const updatedFeature = updatedResult?.agent.features?.find(
      (candidate) => candidate.id === normalizedFeatureId,
    );
    const finalValue = updatedFeature
      ? formatFeatureValue(updatedFeature.value)
      : formatFeatureValue(validated[normalizedFeatureId]);

    return {
      type: "single",
      data: {
        agentId: agent.id,
        feature: normalizedFeatureId,
        value: finalValue,
      },
      schema: setAgentFeatureSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    if (!client) {
      const message = error instanceof Error ? error.message : String(error);
      throw {
        code: "DAEMON_NOT_RUNNING",
        message: `Cannot connect to daemon at ${host}: ${message}`,
        details: "Start the daemon with: paseo daemon start",
      } satisfies CommandError;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "FEATURE_OPERATION_FAILED",
      message: `Failed to ${options.list ? "list features" : "set feature"}: ${message}`,
    } satisfies CommandError;
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

function missingFeatureError(): CommandError {
  return {
    code: "MISSING_ARGUMENT",
    message: "Feature ID argument required unless --list is specified",
    details:
      "Usage: paseo agent feature <id> <feature-id> [value] | paseo agent feature <id> --list",
  };
}

function toAgentFeatureListItem(feature: AgentFeature): AgentFeatureListItem {
  return {
    id: feature.id,
    label: feature.label,
    type: feature.type,
    value: formatFeatureValue(feature.value),
    options: formatFeatureOptions(feature),
    description: feature.description ?? feature.tooltip ?? "",
  };
}
