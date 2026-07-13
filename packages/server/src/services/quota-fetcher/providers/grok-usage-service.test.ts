import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { ProviderUsage } from "../../../server/messages.js";
import type { GrokQuotaProvider } from "./grok.js";
import { GrokUsageService } from "./grok-usage-service.js";

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createLogger(),
  } as unknown as Logger;
}

const LIVE_USAGE: ProviderUsage = {
  providerId: "grok",
  displayName: "Grok Build",
  status: "available",
  planLabel: "Grok Build",
  windows: [{ id: "monthly", label: "Monthly", usedPct: 10, tone: "ok" }],
  balances: [
    {
      id: "monthly_credits",
      label: "Monthly credits",
      used: 10,
      remaining: 90,
      limit: 100,
      unit: "credits",
      tone: "ok",
    },
  ],
  details: [],
  error: null,
};

function createLiveFetcher(usage: ProviderUsage = LIVE_USAGE): GrokQuotaProvider {
  return {
    providerId: "grok",
    displayName: "Grok Build",
    fetchUsage: vi.fn(async () => usage),
  } as unknown as GrokQuotaProvider;
}

describe("GrokUsageService", () => {
  it("returns a placeholder from the cache until the first sync", () => {
    const service = new GrokUsageService({
      logger: createLogger(),
      liveFetcher: createLiveFetcher(),
      resolveToken: async () => "token",
    });
    const cached = service.getCachedUsage();
    expect(cached.status).toBe("unavailable");
    expect(cached.windows).toEqual([]);
  });

  it("live-fetches on force sync and caches the result", async () => {
    const liveFetcher = createLiveFetcher();
    const service = new GrokUsageService({
      logger: createLogger(),
      liveFetcher,
      resolveToken: async () => "token",
    });
    const changes: Array<{ authenticated: boolean; usage: ProviderUsage | null }> = [];
    service.onChange((change) => changes.push(change));

    const usage = await service.syncUsage({ force: true });
    expect(usage.status).toBe("available");
    expect(liveFetcher.fetchUsage).toHaveBeenCalledTimes(1);
    expect(service.getCachedUsage().balances?.[0]?.remaining).toBe(90);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.authenticated).toBe(true);
    expect(changes[0]?.usage?.status).toBe("available");
  });

  it("throttles automatic syncs within the window", async () => {
    let nowMs = 1_000;
    const liveFetcher = createLiveFetcher();
    const service = new GrokUsageService({
      logger: createLogger(),
      liveFetcher,
      resolveToken: async () => "token",
      now: () => nowMs,
    });

    await service.syncUsage({ force: true });
    nowMs += 60_000;
    await service.syncUsage();
    expect(liveFetcher.fetchUsage).toHaveBeenCalledTimes(1);

    nowMs += 5 * 60 * 1000;
    await service.syncUsage();
    expect(liveFetcher.fetchUsage).toHaveBeenCalledTimes(2);
  });

  it("exposes a cache-only list fetcher", async () => {
    const liveFetcher = createLiveFetcher();
    const service = new GrokUsageService({
      logger: createLogger(),
      liveFetcher,
      resolveToken: async () => "token",
    });
    await service.syncUsage({ force: true });
    const listFetcher = service.asCachedFetcher();
    const listed = await listFetcher.fetchUsage();
    expect(listed.status).toBe("available");
    // List path must not call live fetch again.
    expect(liveFetcher.fetchUsage).toHaveBeenCalledTimes(1);
  });

  it("reports authentication from the token probe", async () => {
    const service = new GrokUsageService({
      logger: createLogger(),
      liveFetcher: createLiveFetcher(),
      resolveToken: async () => null,
    });
    await expect(service.status()).resolves.toEqual({ authenticated: false });
  });
});
