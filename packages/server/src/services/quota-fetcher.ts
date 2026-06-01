/**
 * QuotaFetcherService
 *
 * Fetches live plan quota utilization from the Claude and Codex provider APIs,
 * mirroring what tokscale does in crates/tokscale-cli/src/commands/usage/claude.rs
 * and codex.rs — but in TypeScript on the daemon side.
 *
 * Broadcasts a `provider_quota` WebSocket message to all connected clients.
 * Polls every 15 minutes; also exposed as triggerFetch() for on-demand refresh.
 */

import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "pino";
import type { ProviderQuotaMessage, ProviderQuotaWindow } from "../server/messages.js";

const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export interface QuotaFetcherServiceOptions {
  broadcast: (message: ProviderQuotaMessage) => void;
  logger: Logger;
  claudeHome?: string;
  codexHome?: string;
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Credential file shapes
// ---------------------------------------------------------------------------

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

interface CodexAuth {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface ClaudeUsageWindow {
  utilization: number;
  resets_at?: string;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow;
  seven_day?: ClaudeUsageWindow;
  seven_day_opus?: ClaudeUsageWindow;
}

interface ClaudeTokenRefresh {
  access_token?: string;
  refresh_token?: string;
}

interface CodexWindow {
  used_percent?: number;
  reset_at?: number;
}

interface CodexUsageResponse {
  plan_type?: string;
  email?: string;
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
}

interface CodexTokenRefresh {
  access_token?: string;
  refresh_token?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class QuotaFetcherService {
  private readonly broadcastFn: (message: ProviderQuotaMessage) => void;
  private readonly logger: Logger;
  private readonly claudeHome: string;
  private readonly codexHome: string;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private cached: ProviderQuotaMessage | null = null;
  private isFetching = false;
  private pendingFetch = false;

  constructor(options: QuotaFetcherServiceOptions) {
    this.broadcastFn = options.broadcast;
    this.logger = options.logger.child({ module: "quota-fetcher" });
    this.claudeHome = options.claudeHome ?? join(homedir(), ".claude");
    this.codexHome = options.codexHome ?? join(homedir(), ".codex");
    this.pollIntervalMs = options.pollIntervalMs ?? 15 * 60 * 1000;
  }

  public start(): void {
    if (this.timer) return;
    void this.triggerFetch();
    this.timer = setInterval(() => {
      void this.triggerFetch();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getCached(): ProviderQuotaMessage | null {
    return this.cached;
  }

  public async triggerFetch(): Promise<void> {
    if (this.isFetching) {
      this.pendingFetch = true;
      return;
    }
    this.isFetching = true;
    try {
      await this.performFetch();
    } catch (err) {
      this.logger.warn({ err }, "QuotaFetcherService fetch failed");
    } finally {
      this.isFetching = false;
      if (this.pendingFetch) {
        this.pendingFetch = false;
        setImmediate(() => void this.triggerFetch());
      }
    }
  }

  // -------------------------------------------------------------------------
  // Core fetch
  // -------------------------------------------------------------------------

  private async performFetch(): Promise<void> {
    const [claudeResult, codexResult] = await Promise.allSettled([
      this.fetchClaudeQuota(),
      this.fetchCodexQuota(),
    ]);

    const claude = claudeResult.status === "fulfilled" ? claudeResult.value : undefined;
    const codex = codexResult.status === "fulfilled" ? codexResult.value : undefined;

    if (claudeResult.status === "rejected") {
      this.logger.debug({ err: claudeResult.reason }, "Claude quota fetch failed");
    }
    if (codexResult.status === "rejected") {
      this.logger.debug({ err: codexResult.reason }, "Codex quota fetch failed");
    }

    if (!claude && !codex) return;

    const next: ProviderQuotaMessage = {
      type: "provider_quota",
      payload: { claude, codex, fetchedAt: new Date().toISOString() },
    };

    const { fetchedAt: _a, ...prevData } = this.cached?.payload ?? {};
    const { fetchedAt: _b, ...nextData } = next.payload;
    const changed = !this.cached || JSON.stringify(prevData) !== JSON.stringify(nextData);
    this.cached = next;
    if (changed) {
      this.broadcastFn(next);
    }
  }

  // -------------------------------------------------------------------------
  // Claude
  // -------------------------------------------------------------------------

  private async fetchClaudeQuota(): Promise<ProviderQuotaMessage["payload"]["claude"]> {
    const credPath = join(this.claudeHome, ".credentials.json");
    if (!existsSync(credPath)) return undefined;

    const raw = await fs.readFile(credPath, "utf8");
    const creds: ClaudeCredentials = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken) return undefined;

    const plan = buildClaudePlan(oauth.subscriptionType, oauth.rateLimitTier);

    let resp = await this.callClaudeApi(oauth.accessToken);

    if (resp === "NEEDS_AUTH") {
      if (!oauth.refreshToken) return undefined;
      const refreshed = await this.refreshClaudeToken(oauth.refreshToken);
      if (!refreshed?.access_token) return undefined;

      // Save refreshed tokens back to disk
      await this.saveClaudeCredentials(credPath, {
        ...oauth,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? oauth.refreshToken,
      });

      resp = await this.callClaudeApi(refreshed.access_token);
      if (resp === "NEEDS_AUTH") return undefined;
    }

    return {
      fiveHour: toQuotaWindow(resp.five_hour),
      sevenDay: toQuotaWindow(resp.seven_day),
      sevenDayOpus: toQuotaWindow(resp.seven_day_opus),
      plan,
    };
  }

  private async callClaudeApi(token: string): Promise<ClaudeUsageResponse | "NEEDS_AUTH"> {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "anthropic-beta": CLAUDE_OAUTH_BETA,
      },
    });
    if (res.status === 401 || res.status === 403) return "NEEDS_AUTH";
    if (!res.ok) throw new Error(`Claude usage API returned ${res.status}`);
    return res.json() as Promise<ClaudeUsageResponse>;
  }

  private async refreshClaudeToken(refreshToken: string): Promise<ClaudeTokenRefresh | null> {
    const res = await fetch("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_CLIENT_ID,
        scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers",
      }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<ClaudeTokenRefresh>;
  }

  private async saveClaudeCredentials(
    credPath: string,
    oauth: ClaudeCredentials["claudeAiOauth"],
  ): Promise<void> {
    try {
      const existing = JSON.parse(await fs.readFile(credPath, "utf8")) as ClaudeCredentials;
      existing.claudeAiOauth = oauth;
      await fs.writeFile(credPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
    } catch {
      // Non-fatal — next start will re-read the old token
    }
  }

  // -------------------------------------------------------------------------
  // Codex
  // -------------------------------------------------------------------------

  private async fetchCodexQuota(): Promise<ProviderQuotaMessage["payload"]["codex"]> {
    const auth = await this.readCodexAuth();
    if (!auth?.tokens?.access_token) return undefined;

    const { access_token, refresh_token, account_id } = auth.tokens;

    let resp = await this.callCodexApi(access_token, account_id);

    if (resp === "NEEDS_AUTH") {
      if (!refresh_token) return undefined;
      const refreshed = await this.refreshCodexToken(refresh_token);
      if (!refreshed?.access_token) return undefined;

      await this.saveCodexAuth(auth, refreshed);
      resp = await this.callCodexApi(refreshed.access_token, account_id);
      if (resp === "NEEDS_AUTH") return undefined;
    }

    const toWindow = (w: CodexWindow | undefined) => {
      if (!w) return null;
      return {
        utilizationPct: w.used_percent ?? 0,
        resetsAt: w.reset_at != null ? new Date(w.reset_at * 1000).toISOString() : undefined,
      };
    };

    return {
      session: toWindow(resp.rate_limit?.primary_window),
      weekly: toWindow(resp.rate_limit?.secondary_window),
      planType: resp.plan_type ?? null,
      email: resp.email ?? null,
    };
  }

  private async readCodexAuth(): Promise<CodexAuth | null> {
    const candidates = [
      ...(process.env["CODEX_HOME"] ? [join(process.env["CODEX_HOME"], "auth.json")] : []),
      join(homedir(), ".config", "codex", "auth.json"),
      join(this.codexHome, "auth.json"),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const raw = await fs.readFile(p, "utf8");
        const auth = JSON.parse(raw) as CodexAuth;
        if (auth.tokens?.access_token) return auth;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async callCodexApi(
    token: string,
    accountId?: string,
  ): Promise<CodexUsageResponse | "NEEDS_AUTH"> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;

    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
    if (res.status === 401 || res.status === 403) return "NEEDS_AUTH";
    if (!res.ok) throw new Error(`Codex usage API returned ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith("<")) return "NEEDS_AUTH";
    return JSON.parse(text) as CodexUsageResponse;
  }

  private async refreshCodexToken(refreshToken: string): Promise<CodexTokenRefresh | null> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    });
    const res = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) return null;
    return res.json() as Promise<CodexTokenRefresh>;
  }

  private async saveCodexAuth(original: CodexAuth, refreshed: CodexTokenRefresh): Promise<void> {
    const candidates = [
      ...(process.env["CODEX_HOME"] ? [join(process.env["CODEX_HOME"], "auth.json")] : []),
      join(homedir(), ".config", "codex", "auth.json"),
      join(this.codexHome, "auth.json"),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const updated: CodexAuth = {
          ...original,
          tokens: {
            ...original.tokens,
            access_token: refreshed.access_token ?? original.tokens?.access_token,
            refresh_token: refreshed.refresh_token ?? original.tokens?.refresh_token,
          },
        };
        await fs.writeFile(p, JSON.stringify(updated, null, 2), { mode: 0o600 });
      } catch {
        // Non-fatal
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toQuotaWindow(w: ClaudeUsageWindow | undefined): ProviderQuotaWindow | null {
  if (!w) return null;
  return { utilizationPct: w.utilization, resetsAt: w.resets_at };
}

function buildClaudePlan(
  subscriptionType: string | undefined,
  rateLimitTier: string | undefined,
): string | null {
  if (!subscriptionType) return null;
  const label = subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
  const tier = rateLimitTier?.split("_").pop();
  return tier ? `${label} ${tier}` : label;
}
