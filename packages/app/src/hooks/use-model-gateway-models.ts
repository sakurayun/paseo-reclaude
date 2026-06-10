import { useQuery } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

type ModelGatewayInput =
  | { type: "native"; id?: string; label?: string; provider?: string }
  | {
      type: "openai-compatible";
      id?: string;
      label?: string;
      provider?: string;
      baseUrl: string;
      model?: string;
      apiKey?: string;
    };

interface ModelGatewayModelsResult {
  modelIds: string[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

function getCredentialCacheKey(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `${value.length}:${hash}`;
}

export function useModelGatewayModels(
  serverId: string,
  gateway: ModelGatewayInput | undefined,
): ModelGatewayModelsResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isDiscoverable = gateway?.type === "openai-compatible" && Boolean(gateway.baseUrl.trim());

  const query = useQuery({
    queryKey: [
      "model-gateway-models",
      serverId,
      gateway?.type === "openai-compatible" ? (gateway.id ?? gateway.baseUrl) : null,
      gateway?.type === "openai-compatible" ? gateway.baseUrl : null,
      gateway?.type === "openai-compatible" ? getCredentialCacheKey(gateway.apiKey) : null,
    ],
    enabled: Boolean(client && isConnected && isDiscoverable),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client || gateway?.type !== "openai-compatible") {
        return [];
      }
      const result = await client.listModelGatewayModels({
        type: "openai-compatible",
        ...(gateway.id ? { id: gateway.id } : {}),
        ...(gateway.label ? { label: gateway.label } : {}),
        ...(gateway.provider ? { provider: gateway.provider } : {}),
        baseUrl: gateway.baseUrl,
        ...(gateway.model ? { model: gateway.model } : {}),
        ...(gateway.apiKey ? { apiKey: gateway.apiKey } : {}),
      });
      if (result.error) {
        throw new Error(result.error);
      }
      return result.models;
    },
  });

  return {
    modelIds: query.data ?? [],
    isLoading: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => {
      void query.refetch();
    },
  };
}
