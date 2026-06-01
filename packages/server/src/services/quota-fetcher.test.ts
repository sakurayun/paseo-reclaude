import { writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaFetcherService } from "./quota-fetcher.js";
import type { ProviderQuotaMessage } from "../server/messages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeCreds(
  dir: string,
  accessToken: string,
  refreshToken = "rt_test",
  subscriptionType = "pro",
  rateLimitTier = "default_1x",
): void {
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: { accessToken, refreshToken, subscriptionType, rateLimitTier },
    }),
  );
}

function writeCodexAuth(dir: string, accessToken: string, refreshToken = "rt_codex"): void {
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({ tokens: { access_token: accessToken, refresh_token: refreshToken } }),
  );
}

function makeClaudeResponse(
  overrides: Partial<{
    five_hour: { utilization: number; resets_at: string };
    seven_day: { utilization: number; resets_at: string };
    seven_day_opus: { utilization: number; resets_at: string };
  }> = {},
) {
  return {
    five_hour: { utilization: 11.0, resets_at: "2026-06-01T21:00:00Z" },
    seven_day: { utilization: 1.0, resets_at: "2026-06-04T00:00:00Z" },
    seven_day_opus: { utilization: 0.5, resets_at: "2026-06-04T00:00:00Z" },
    ...overrides,
  };
}

function makeCodexResponse(overrides: object = {}) {
  return {
    plan_type: "plus",
    email: "user@example.com",
    rate_limit: {
      primary_window: { used_percent: 42, reset_at: 1748812800 },
      secondary_window: { used_percent: 8, reset_at: 1749072000 },
    },
    ...overrides,
  };
}

function mockFetch(handlers: Map<string, () => Response>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = url.toString();
    const handler = handlers.get(key);
    if (!handler) throw new Error(`Unmocked fetch: ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuotaFetcherService", () => {
  let claudeHome: string;
  let codexHome: string;
  let broadcasts: ProviderQuotaMessage[];
  let service: QuotaFetcherService;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    claudeHome = mkdtempSync(join(tmpdir(), "quota-test-claude-"));
    codexHome = mkdtempSync(join(tmpdir(), "quota-test-codex-"));
    broadcasts = [];
    originalFetch = globalThis.fetch;
    service = new QuotaFetcherService({
      broadcast: (msg) => broadcasts.push(msg),
      logger: {
        child: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
      } as never,
      claudeHome,
      codexHome,
      pollIntervalMs: 999_999,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    service.stop();
    rmSync(claudeHome, { recursive: true, force: true });
    rmSync(codexHome, { recursive: true, force: true });
  });

  // ── Claude ─────────────────────────────────────────────────────────────

  describe("Claude quota", () => {
    it("returns quota windows when credentials exist and API succeeds", async () => {
      writeCreds(claudeHome, "at_valid");
      globalThis.fetch = mockFetch(
        new Map([
          ["https://api.anthropic.com/api/oauth/usage", () => jsonResponse(makeClaudeResponse())],
        ]),
      );

      await service.triggerFetch();

      expect(broadcasts).toHaveLength(1);
      const { claude } = broadcasts[0].payload;
      expect(claude?.fiveHour?.utilizationPct).toBe(11.0);
      expect(claude?.sevenDay?.utilizationPct).toBe(1.0);
      expect(claude?.sevenDayOpus?.utilizationPct).toBe(0.5);
      expect(claude?.plan).toBe("Pro 1x");
    });

    it("skips Claude when credentials file is missing", async () => {
      // no writeCreds — file absent
      globalThis.fetch = vi.fn() as never; // should not be called

      await service.triggerFetch();

      expect(broadcasts).toHaveLength(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("refreshes access token on 401 and retries", async () => {
      writeCreds(claudeHome, "at_expired", "rt_valid");
      let callCount = 0;
      async function handleRefreshFlow(url: RequestInfo | URL) {
        const u = url.toString();
        if (u === "https://api.anthropic.com/api/oauth/usage") {
          callCount++;
          if (callCount === 1) return new Response(null, { status: 401 });
          return jsonResponse(makeClaudeResponse());
        }
        if (u === "https://platform.claude.com/v1/oauth/token") {
          return jsonResponse({ access_token: "at_refreshed", refresh_token: "rt_new" });
        }
        throw new Error(`Unmocked: ${u}`);
      }
      globalThis.fetch = vi.fn(handleRefreshFlow) as never;

      await service.triggerFetch();

      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].payload.claude?.fiveHour?.utilizationPct).toBe(11.0);
      expect(callCount).toBe(2);
    });

    it("returns no Claude data when 401 persists after token refresh", async () => {
      writeCreds(claudeHome, "at_bad", "rt_bad");
      async function handlePersistentAuth(url: RequestInfo | URL) {
        const u = url.toString();
        if (u === "https://api.anthropic.com/api/oauth/usage")
          return new Response(null, { status: 401 });
        if (u === "https://platform.claude.com/v1/oauth/token") {
          return jsonResponse({ access_token: "at_still_bad", refresh_token: "rt_still_bad" });
        }
        throw new Error(`Unmocked: ${u}`);
      }
      globalThis.fetch = vi.fn(handlePersistentAuth) as never;

      await service.triggerFetch();

      expect(broadcasts).toHaveLength(0);
    });
  });

  // ── Codex ──────────────────────────────────────────────────────────────

  describe("Codex quota", () => {
    it("returns quota windows when auth file exists and API succeeds", async () => {
      writeCreds(claudeHome, "at_claude"); // need Claude too so broadcast fires
      writeCodexAuth(codexHome, "at_codex_valid");
      globalThis.fetch = mockFetch(
        new Map([
          ["https://api.anthropic.com/api/oauth/usage", () => jsonResponse(makeClaudeResponse())],
          ["https://chatgpt.com/backend-api/wham/usage", () => jsonResponse(makeCodexResponse())],
        ]),
      );

      await service.triggerFetch();

      const { codex } = broadcasts[0].payload;
      expect(codex?.session?.utilizationPct).toBe(42);
      expect(codex?.weekly?.utilizationPct).toBe(8);
      expect(codex?.planType).toBe("plus");
      expect(codex?.email).toBe("user@example.com");
    });

    it("treats HTML response as auth failure and skips", async () => {
      writeCreds(claudeHome, "at_claude");
      writeCodexAuth(codexHome, "at_codex_stale");
      globalThis.fetch = mockFetch(
        new Map([
          ["https://api.anthropic.com/api/oauth/usage", () => jsonResponse(makeClaudeResponse())],
          [
            "https://chatgpt.com/backend-api/wham/usage",
            () => new Response("<html>Login</html>", { status: 200 }),
          ],
          ["https://auth.openai.com/oauth/token", () => new Response(null, { status: 401 })],
        ]),
      );

      await service.triggerFetch();

      expect(broadcasts[0].payload.codex).toBeUndefined();
    });
  });

  // ── Broadcast behaviour ────────────────────────────────────────────────

  describe("broadcast deduplication", () => {
    it("broadcasts only once when payload is unchanged", async () => {
      writeCreds(claudeHome, "at_valid");
      globalThis.fetch = mockFetch(
        new Map([
          ["https://api.anthropic.com/api/oauth/usage", () => jsonResponse(makeClaudeResponse())],
        ]),
      );

      await service.triggerFetch();
      await service.triggerFetch();

      expect(broadcasts).toHaveLength(1);
    });

    it("broadcasts again when payload changes", async () => {
      writeCreds(claudeHome, "at_valid");
      let utilization = 11.0;
      async function fetchWithUtilization() {
        return jsonResponse(
          makeClaudeResponse({ five_hour: { utilization, resets_at: "2026-06-01T21:00:00Z" } }),
        );
      }
      globalThis.fetch = vi.fn(fetchWithUtilization) as never;

      await service.triggerFetch();
      utilization = 25.0;
      await service.triggerFetch();

      expect(broadcasts).toHaveLength(2);
      expect(broadcasts[1].payload.claude?.fiveHour?.utilizationPct).toBe(25.0);
    });
  });

  // ── getCached ──────────────────────────────────────────────────────────

  it("getCached returns null before first fetch", () => {
    expect(service.getCached()).toBeNull();
  });

  it("getCached returns last broadcast message after fetch", async () => {
    writeCreds(claudeHome, "at_valid");
    globalThis.fetch = mockFetch(
      new Map([
        ["https://api.anthropic.com/api/oauth/usage", () => jsonResponse(makeClaudeResponse())],
      ]),
    );

    await service.triggerFetch();

    const cached = service.getCached();
    expect(cached?.type).toBe("provider_quota");
    expect(cached?.payload.claude?.fiveHour?.utilizationPct).toBe(11.0);
  });
});
