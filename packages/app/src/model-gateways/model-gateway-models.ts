import { buildFavoriteModelKey } from "@/hooks/use-form-preferences";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import type {
  AgentModelDefinition,
  AgentProvider,
  AgentSessionConfig,
} from "@server/server/agent/agent-sdk-types";

type ModelGatewayConfig = NonNullable<AgentSessionConfig["modelGateway"]>;

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function getModelGatewayModelIds(
  gateway: ModelGatewayConfig | undefined,
  discoveredModelIds: string[] = [],
): string[] {
  if (gateway?.type !== "openai-compatible") {
    return [];
  }
  return uniqueNonEmpty([gateway.model, ...discoveredModelIds]);
}

export function resolveModelGatewayModelId(
  gateway: ModelGatewayConfig | undefined,
  selectedModelId?: string | null,
  discoveredModelIds: string[] = [],
): string {
  const modelIds = getModelGatewayModelIds(gateway, discoveredModelIds);
  const selected = selectedModelId?.trim();
  if (selected && modelIds.includes(selected)) {
    return selected;
  }
  return gateway?.type === "openai-compatible" ? gateway.model?.trim() || modelIds[0] || "" : "";
}

export function buildModelGatewayModelDefinitions(input: {
  provider: AgentProvider | string | null | undefined;
  gateway: ModelGatewayConfig | undefined;
  selectedModelId?: string | null;
  discoveredModelIds?: string[];
}): AgentModelDefinition[] {
  const provider = input.provider as AgentProvider | undefined;
  if (!provider) {
    return [];
  }
  const modelIds = getModelGatewayModelIds(input.gateway, input.discoveredModelIds);
  const selectedModelId = resolveModelGatewayModelId(
    input.gateway,
    input.selectedModelId,
    input.discoveredModelIds,
  );
  return modelIds.map((modelId) => ({
    provider,
    id: modelId,
    label: modelId,
    isDefault: modelId === selectedModelId,
  }));
}

export function buildModelGatewaySelectorProviders(input: {
  provider: AgentProvider | string | null | undefined;
  providerLabel: string;
  models: AgentModelDefinition[];
}): ProviderSelectorProvider[] {
  const provider = input.provider;
  if (!provider || input.models.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: input.providerLabel,
      modelSelection: {
        kind: "models",
        rows: input.models.map((model) => ({
          favoriteKey: buildFavoriteModelKey({ provider, modelId: model.id }),
          provider,
          providerLabel: input.providerLabel,
          modelId: model.id,
          modelLabel: model.label,
          description: model.description,
          isDefault: model.isDefault,
        })),
      },
    },
  ];
}
