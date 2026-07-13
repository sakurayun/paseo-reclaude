import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import {
  extractGrokTokenFromAuthJson,
  GrokQuotaProvider,
  readGrokAuthToken,
  resolveGrokAccessToken,
} from "./grok.js";

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createLogger(),
  } as unknown as Logger;
}

describe("extractGrokTokenFromAuthJson", () => {
  it("reads legacy flat access_token", () => {
    expect(extractGrokTokenFromAuthJson({ access_token: "legacy-token" })).toBe("legacy-token");
  });

  it("reads OIDC credential map key field (current Grok Build auth.json)", () => {
    expect(
      extractGrokTokenFromAuthJson({
        "https://auth.x.ai::client": {
          key: "oidc-jwt",
          auth_mode: "oidc",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    ).toBe("oidc-jwt");
  });

  it("skips expired OIDC entries when a fresh one exists", () => {
    expect(
      extractGrokTokenFromAuthJson({
        expired: {
          key: "old-token",
          expires_at: "2000-01-01T00:00:00Z",
        },
        fresh: {
          key: "new-token",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    ).toBe("new-token");
  });

  it("falls back to an expired OIDC token when nothing fresher exists", () => {
    expect(
      extractGrokTokenFromAuthJson({
        expired: {
          key: "old-token",
          expires_at: "2000-01-01T00:00:00Z",
          refresh_token: "rt",
        },
      }),
    ).toBe("old-token");
  });
});

describe("GrokQuotaProvider", () => {
  const originalEnv = { ...process.env };
  let homeDir: string;

  afterEach(() => {
    process.env = { ...originalEnv };
    delete process.env["XAI_API_KEY"];
    delete process.env["GROK_API_KEY"];
    delete process.env["GROK_TOKEN"];
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("parses live billing payload with config.used and period bounds", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-usage-"));
    mkdirSync(join(homeDir, ".grok"), { recursive: true });
    writeFileSync(
      join(homeDir, ".grok", "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::client": {
          key: "session-token",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    );

    const fetchApi = vi.fn(async () =>
      Response.json({
        config: {
          monthlyLimit: { val: 15000 },
          used: { val: 251 },
          onDemandCap: { val: 0 },
          billingPeriodStart: "2026-07-01T00:00:00+00:00",
          billingPeriodEnd: "2026-08-01T00:00:00+00:00",
          history: [
            {
              billingCycle: { year: 2026, month: 6 },
              totalUsed: { val: 1200 },
            },
          ],
        },
      }),
    );

    const provider = new GrokQuotaProvider({
      logger: createLogger(),
      fetch: fetchApi as unknown as typeof fetch,
      homeDir,
    });

    const usage = await provider.fetchUsage();

    expect(usage).toMatchObject({
      providerId: "grok",
      displayName: "Grok Build",
      status: "available",
      planLabel: "Grok Build",
      balances: [
        expect.objectContaining({
          id: "monthly_credits",
          used: 251,
          remaining: 14749,
          limit: 15000,
          unit: "credits",
        }),
      ],
      windows: [
        expect.objectContaining({
          id: "monthly",
          label: "Monthly",
          resetsAt: "2026-08-01T00:00:00+00:00",
        }),
      ],
    });
    expect(usage.details?.some((row) => row.id === "period_end")).toBe(true);
    expect(fetchApi).toHaveBeenCalledWith(
      "https://cli-chat-proxy.grok.com/v1/billing",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
          "X-XAI-Token-Auth": "xai-grok-cli",
        }),
      }),
    );
  });

  it("accepts legacy usage.creditUsage payloads", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-usage-legacy-"));
    process.env["GROK_API_KEY"] = "env-token";

    const provider = new GrokQuotaProvider({
      logger: createLogger(),
      homeDir,
      fetch: (async () =>
        Response.json({
          config: { monthlyLimit: { val: 0 } },
          usage: { creditUsage: 0 },
        })) as unknown as typeof fetch,
    });

    const usage = await provider.fetchUsage();
    expect(usage.status).toBe("available");
    expect(usage.balances?.[0]).toMatchObject({ used: 0, remaining: 0, limit: 0 });
  });

  it("uses XAI_API_KEY when auth.json is absent", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-usage-xai-"));
    process.env["XAI_API_KEY"] = "xai-key";
    expect(await resolveGrokAccessToken({ homeDir })).toBe("xai-key");
    expect(await readGrokAuthToken(homeDir)).toBeNull();
  });

  it("returns a helpful unavailable message when no credentials exist", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-usage-empty-"));
    const provider = new GrokQuotaProvider({
      logger: createLogger(),
      homeDir,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const usage = await provider.fetchUsage();
    // unavailableUsage maps a non-null error string to status "error" so the
    // settings card can show the remediation hint.
    expect(usage.status).toBe("error");
    expect(usage.error).toMatch(/grok login|XAI_API_KEY/i);
  });

  it("refreshes OIDC tokens on HTTP 401 and retries billing", async () => {
    homeDir = mkdtempSync(join(tmpdir(), "grok-usage-refresh-"));
    mkdirSync(join(homeDir, ".grok"), { recursive: true });
    const authPath = join(homeDir, ".grok", "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        "https://auth.x.ai::client": {
          key: "expired-jwt",
          refresh_token: "rt-1",
          oidc_issuer: "https://auth.x.ai",
          oidc_client_id: "client",
          expires_at: "2000-01-01T00:00:00Z",
        },
      }),
    );

    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openid-configuration")) {
        return Response.json({ token_endpoint: "https://auth.x.ai/oauth/token" });
      }
      if (url.includes("/oauth/token")) {
        return Response.json({
          access_token: "fresh-jwt",
          refresh_token: "rt-2",
          expires_in: 3600,
        });
      }
      if (url.includes("/v1/billing")) {
        const headers = init?.headers as Record<string, string> | undefined;
        const header = headers?.Authorization ?? "";
        // Early refresh should run before billing because expires_at is past.
        if (header.includes("fresh-jwt")) {
          return Response.json({
            config: { monthlyLimit: { val: 100 }, used: { val: 10 } },
          });
        }
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected url ${url}`);
    });

    const provider = new GrokQuotaProvider({
      logger: createLogger(),
      homeDir,
      fetch: fetchApi as unknown as typeof fetch,
    });
    const usage = await provider.fetchUsage();
    expect(usage.status).toBe("available");
    expect(usage.balances?.[0]).toMatchObject({ used: 10, limit: 100, remaining: 90 });
  });
});
