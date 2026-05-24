import type { AgentSessionConfig } from "@server/server/agent/agent-sdk-types";

export function buildWorkspaceDraftAgentConfig(input: {
  provider: AgentSessionConfig["provider"];
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  modelGateway?: AgentSessionConfig["modelGateway"];
  featureValues?: Record<string, unknown>;
}): AgentSessionConfig {
  return {
    provider: input.provider,
    cwd: input.cwd,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.modelGateway ? { modelGateway: input.modelGateway } : {}),
    ...(input.featureValues ? { featureValues: input.featureValues } : {}),
  };
}
