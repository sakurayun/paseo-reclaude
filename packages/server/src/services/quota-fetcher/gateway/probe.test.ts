import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { probeGatewayUsage } from "./probe.js";

const logger = pino({ level: "silent" });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("probeGatewayUsage", () => {
  it("maps NewAPI /api/usage/token into USD balances", async () => {
    const fetchApi = vi.fn(async (url: RequestInfo | URL) => {
      const endpoint = url.toString();
      if (endpoint.endsWith("/api/usage/token")) {
        return jsonResponse({
          code: true,
          message: "ok",
          data: {
            object: "token_usage",
            name: "desk",
            total_granted: 1_000_000,
            total_used: 250_000,
            total_available: 750_000,
            unlimited_quota: false,
          },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const usage = await probeGatewayUsage({
      auth: {
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        source: "test",
      },
      providerId: "codex",
      displayName: "Codex",
      fetchApi,
      logger,
    });

    expect(usage?.status).toBe("available");
    expect(usage?.planLabel).toBe("NewAPI");
    expect(usage?.balances?.[0]).toMatchObject({
      id: "quota",
      unit: "usd",
      used: 0.5,
      remaining: 1.5,
      limit: 2,
    });
    expect(usage?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gateway", value: "NewAPI" }),
        expect.objectContaining({ id: "token_name", value: "desk" }),
      ]),
    );
  });

  it("maps unlimited NewAPI tokens", async () => {
    const fetchApi = vi.fn(async (url: RequestInfo | URL) => {
      if (url.toString().endsWith("/api/usage/token")) {
        return jsonResponse({
          code: true,
          data: {
            object: "token_usage",
            total_used: 500_000,
            total_available: -1,
            unlimited_quota: true,
          },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const usage = await probeGatewayUsage({
      auth: { baseUrl: "https://relay.example.com", apiKey: "sk", source: "test" },
      providerId: "claude",
      displayName: "Claude",
      fetchApi,
      logger,
    });

    expect(usage?.planLabel).toBe("NewAPI · Unlimited");
    expect(usage?.balances?.[0]).toMatchObject({ id: "used", used: 1, unit: "usd" });
  });

  it("maps Sub2API /v1/usage quota + rate windows", async () => {
    const fetchApi = vi.fn(async (url: RequestInfo | URL) => {
      const endpoint = url.toString();
      if (endpoint.includes("/api/usage/token")) {
        return new Response(null, { status: 404 });
      }
      if (endpoint.endsWith("/v1/usage")) {
        return jsonResponse({
          mode: "quota_limited",
          isValid: true,
          quota: { limit: 20, used: 5, remaining: 15, unit: "USD" },
          rate_limits: [
            { window: "5h", limit: 10, used: 2, remaining: 8 },
            { window: "7d", limit: 50, used: 10, remaining: 40 },
          ],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const usage = await probeGatewayUsage({
      auth: { baseUrl: "https://sub2.example.com/v1", apiKey: "sk", source: "test" },
      providerId: "claude",
      displayName: "Claude",
      fetchApi,
      logger,
    });

    expect(usage?.status).toBe("available");
    expect(usage?.planLabel).toBe("Sub2API");
    expect(usage?.balances?.[0]).toMatchObject({
      remaining: 15,
      limit: 20,
      used: 5,
      unit: "usd",
    });
    expect(usage?.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rate_5h", usedPct: 20 }),
        expect.objectContaining({ id: "rate_7d", usedPct: 20 }),
      ]),
    );
  });

  it("maps CPA management auth-files when the key is a management key", async () => {
    const fetchApi = vi.fn(async (url: RequestInfo | URL) => {
      const endpoint = url.toString();
      if (endpoint.includes("/api/usage/token") || endpoint.endsWith("/v1/usage")) {
        return new Response(null, { status: 404 });
      }
      if (endpoint.includes("/v0/management/auth-files")) {
        return jsonResponse({
          files: [
            {
              name: "codex-a.json",
              provider: "codex",
              email: "a@example.com",
              id_token: { plan_type: "plus" },
            },
            { name: "claude-b.json", provider: "claude", disabled: true },
            { name: "claude-c.json", provider: "claude", email: "c@example.com" },
          ],
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const usage = await probeGatewayUsage({
      auth: { baseUrl: "http://127.0.0.1:8317/v1", apiKey: "mgmt-key", source: "test" },
      providerId: "codex",
      displayName: "Codex",
      fetchApi,
      logger,
    });

    expect(usage?.status).toBe("available");
    expect(usage?.planLabel).toContain("CPA");
    expect(usage?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gateway", value: "CPA (CLIProxyAPI)" }),
        expect.objectContaining({ id: "accounts", value: "2" }),
      ]),
    );
  });

  it("returns null when no gateway matches", async () => {
    const fetchApi = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
    const usage = await probeGatewayUsage({
      auth: { baseUrl: "https://unknown.example.com/v1", apiKey: "sk", source: "test" },
      providerId: "codex",
      displayName: "Codex",
      fetchApi,
      logger,
    });
    expect(usage).toBeNull();
  });

  it("probeAllGatewayKinds returns one entry per platform", async () => {
    const { probeAllGatewayKinds } = await import("./probe.js");
    const fetchApi = vi.fn(async (url: RequestInfo | URL) => {
      if (url.toString().endsWith("/api/usage/token")) {
        return jsonResponse({
          code: true,
          data: {
            object: "token_usage",
            total_granted: 500_000,
            total_used: 0,
            total_available: 500_000,
            unlimited_quota: false,
          },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const results = await probeAllGatewayKinds({
      auth: { baseUrl: "https://relay.example.com/v1", apiKey: "sk", source: "test" },
      providerId: "codex",
      displayName: "Codex",
      fetchApi,
      logger,
    });

    expect(results.map((r) => r.kind)).toEqual(["newapi", "sub2api", "cpa"]);
    expect(results[0]?.usage?.status).toBe("available");
    expect(results[1]?.usage).toBeNull();
    expect(results[2]?.usage).toBeNull();
  });
});
