import { describe, expect, test, vi } from "vitest";
import { getModelGatewayModelsUrl, listModelGatewayModels } from "./model-gateway-models.js";

describe("model gateway model catalog", () => {
  test("builds a models endpoint without duplicate separators", () => {
    expect(getModelGatewayModelsUrl("http://router.local/v1/")).toBe(
      "http://router.local/v1/models",
    );
  });

  test("lists distinct OpenAI-compatible model IDs with gateway authentication", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "openai-all" }, { id: "gemini" }, { id: "openai-all" }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      listModelGatewayModels(
        {
          type: "openai-compatible",
          baseUrl: "http://router.local/v1/",
          apiKey: "router-key",
        },
        { fetchImpl },
      ),
    ).resolves.toEqual(["openai-all", "gemini"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://router.local/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer router-key" },
      }),
    );
  });

  test("rejects invalid model catalog payloads", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      listModelGatewayModels(
        { type: "openai-compatible", baseUrl: "http://router.local/v1" },
        {
          fetchImpl,
        },
      ),
    ).rejects.toThrow("invalid model catalog");
  });
});
