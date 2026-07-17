import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import {
  codexAuthFileExists,
  readCodexAccountRateLimits,
} from "../../../server/agent/providers/codex/account-rpc.js";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import {
  assembleMultiSourceUsage,
  probeAllGatewayKinds,
  type GatewayProbeResult,
} from "../gateway/probe.js";
import { isCodexChatgptAuth, resolveCodexGatewayAuth } from "../gateway/resolve-auth.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import { balanceToneFromRemaining, unavailableUsage, windowFromUsedPct } from "../usage.js";

interface CodexQuotaProviderOptions {
  logger: Logger;
  codexHome?: string;
  fetch?: ProviderApiFetch;
  env?: NodeJS.ProcessEnv;
  /** Optional agents.providers.codex.env from Paseo config. */
  providerEnv?: Record<string, string> | null;
}

// Codex usage sources:
// 1. ChatGPT OAuth rate-limits via short-lived `codex app-server` (official)
// 2. NewAPI / Sub2API / CPA via OPENAI_BASE_URL + OPENAI_API_KEY (gateway tabs)
//
// API-key-only auth.json never spawns the app-server (it fails with
// "ChatGPT authentication required to read rate limits"). Gateway probes run
// whenever a custom base URL + key is configured.
export class CodexQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "codex";
  readonly displayName = "Codex";

  private readonly logger: Logger;
  private readonly codexHome: string;
  private readonly fetchApi: ProviderApiFetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly providerEnv: Record<string, string> | null;

  constructor(options: CodexQuotaProviderOptions) {
    this.logger = options.logger;
    this.codexHome = options.codexHome || process.env["CODEX_HOME"] || join(homedir(), ".codex");
    this.fetchApi = options.fetch ?? fetch;
    this.env = options.env ?? process.env;
    this.providerEnv = options.providerEnv ?? null;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const [official, gatewayResults] = await Promise.all([
      this.fetchOfficialUsage(),
      this.fetchGatewayResults(),
    ]);

    // No official signal and no gateway credentials → plain unavailable.
    if (!official && (!gatewayResults || gatewayResults.length === 0)) {
      return unavailableUsage(this);
    }

    return assembleMultiSourceUsage({
      providerId: this.providerId,
      displayName: this.displayName,
      official,
      gatewayResults: gatewayResults ?? undefined,
    });
  }

  private async fetchOfficialUsage(): Promise<ProviderUsage | null> {
    const hasAuthFile = codexAuthFileExists(this.codexHome);
    if (!hasAuthFile) return null;

    // API-key-only installs must NOT spawn app-server.
    const isChatgpt = await isCodexChatgptAuth(this.codexHome);
    if (!isChatgpt) {
      this.logger.debug("Codex auth is API-key only; skipping official rate-limits");
      return null;
    }

    try {
      const limits = await readCodexAccountRateLimits({
        logger: this.logger,
        codexHome: this.codexHome,
      });

      const windows: ProviderUsageWindow[] = [];
      if (limits.primary) {
        const usedPct = limits.primary.usedPct ?? 0;
        windows.push(
          windowFromUsedPct({
            id: "session",
            label: "Session",
            utilizationPct: limits.primary.usedPct,
            resetsAt: limits.primary.resetsAt,
            tone: usedPct >= 90 ? "warning" : "ok",
          }),
        );
      }
      if (limits.secondary) {
        const usedPct = limits.secondary.usedPct ?? 0;
        windows.push(
          windowFromUsedPct({
            id: "weekly",
            label: "Weekly",
            utilizationPct: limits.secondary.usedPct,
            resetsAt: limits.secondary.resetsAt,
            tone: usedPct >= 70 ? "warning" : "ok",
          }),
        );
      }

      const balances: ProviderUsageBalance[] = [];
      if (limits.credits?.balanceUsd != null) {
        balances.push({
          id: "credits",
          label: "Credits",
          remaining: limits.credits.balanceUsd,
          unit: "usd",
          tone: balanceToneFromRemaining(limits.credits.balanceUsd),
        });
      }

      if (windows.length === 0 && balances.length === 0 && limits.availableResetCredits == null) {
        return null;
      }

      return {
        providerId: this.providerId,
        displayName: this.displayName,
        status: "available",
        planLabel: limits.planType,
        windows,
        balances,
        details: [],
        error: null,
        availableResetCredits: limits.availableResetCredits,
        rateLimitReached: limits.rateLimitReached,
      };
    } catch (error) {
      // Never surface "ChatGPT authentication required…" as the top-level error
      // when a custom gateway can still be queried.
      this.logger.debug({ err: error }, "Codex official rate-limit read failed");
      return null;
    }
  }

  private async fetchGatewayResults(): Promise<GatewayProbeResult[] | null> {
    const auth = await resolveCodexGatewayAuth({
      codexHome: this.codexHome,
      env: this.env,
      providerEnv: this.providerEnv,
    });
    if (!auth) {
      this.logger.debug("No Codex gateway base URL + key configured");
      return null;
    }
    this.logger.debug(
      { baseUrl: auth.baseUrl, source: auth.source },
      "Probing Codex gateway usage sources",
    );
    return probeAllGatewayKinds({
      auth,
      providerId: this.providerId,
      displayName: this.displayName,
      fetchApi: this.fetchApi,
      logger: this.logger,
    });
  }
}
