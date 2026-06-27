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
import type { ProviderUsageFetcher } from "../provider.js";
import { balanceToneFromRemaining, unavailableUsage, windowFromUsedPct } from "../usage.js";

interface CodexQuotaProviderOptions {
  logger: Logger;
  codexHome?: string;
}

// Codex usage is now sourced from the Codex app-server `account/rateLimits/read`
// JSON-RPC (spawned short-lived) instead of the legacy HTTP `wham/usage`
// endpoint. The app-server owns ChatGPT auth + token refresh, so this provider
// no longer reads or rewrites auth.json. See codex/account-rpc.ts.
export class CodexQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "codex";
  readonly displayName = "Codex";

  private readonly logger: Logger;
  private readonly codexHome: string;

  constructor(options: CodexQuotaProviderOptions) {
    this.logger = options.logger;
    this.codexHome = options.codexHome || process.env["CODEX_HOME"] || join(homedir(), ".codex");
  }

  async fetchUsage(): Promise<ProviderUsage> {
    // Never spawn an app-server for a Codex install that was never logged in.
    if (!codexAuthFileExists(this.codexHome)) {
      return unavailableUsage(this);
    }

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

    // No usable signal at all (e.g. apiKey-mode auth) — report unavailable so the
    // card/usage UI hides instead of showing an empty Codex row.
    if (windows.length === 0 && balances.length === 0 && limits.availableResetCredits == null) {
      return unavailableUsage(this);
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
  }
}
