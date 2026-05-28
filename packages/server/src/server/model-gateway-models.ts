import { z } from "zod";
import type { ModelGatewayConfig } from "@getpaseo/protocol/messages";

type OpenAICompatibleGateway = Extract<ModelGatewayConfig, { type: "openai-compatible" }>;

const GatewayModelsResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().trim().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function getModelGatewayModelsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/models`;
}

export async function listModelGatewayModels(
  gateway: OpenAICompatibleGateway,
  input: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  try {
    const response = await (input.fetchImpl ?? fetch)(getModelGatewayModelsUrl(gateway.baseUrl), {
      method: "GET",
      headers: gateway.apiKey ? { Authorization: `Bearer ${gateway.apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Gateway returned HTTP ${response.status} while listing models.`);
    }

    const parsed = GatewayModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Gateway returned an invalid model catalog.");
    }

    return [...new Set(parsed.data.data.map((entry) => entry.id))];
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Gateway model catalog request timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
