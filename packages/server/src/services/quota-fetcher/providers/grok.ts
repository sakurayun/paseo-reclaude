import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  balanceToneFromRemaining,
  fetchProviderApi,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
/** Match Grok CLI: refresh a few minutes before wall-clock expiry. */
const GROK_AUTH_EARLY_REFRESH_MS = 5 * 60 * 1000;

/** Nested `{ val: number }` wrapper used by Grok Build billing payloads. */
const GrokValSchema = z
  .object({
    val: ApiNumberSchema.optional(),
  })
  .nullish();

/**
 * Live Grok Build billing shape (2026-07+).
 *
 * The CLI chat proxy returns monthly included credits under `config.used`, with
 * optional on-demand cap and billing-period bounds. Older payloads put usage under
 * `usage.creditUsage` — both are accepted so caches and mocks keep working.
 */
const GrokUsageResponseSchema = z.object({
  config: z
    .object({
      monthlyLimit: GrokValSchema,
      used: GrokValSchema,
      onDemandCap: GrokValSchema,
      billingPeriodStart: z.string().nullish(),
      billingPeriodEnd: z.string().nullish(),
      history: z
        .array(
          z
            .object({
              billingCycle: z
                .object({
                  year: ApiNumberSchema.optional(),
                  month: ApiNumberSchema.optional(),
                })
                .nullish(),
              includedUsed: GrokValSchema,
              onDemandUsed: GrokValSchema,
              totalUsed: GrokValSchema,
            })
            .passthrough(),
        )
        .nullish(),
    })
    .nullish(),
  // COMPAT(legacy Grok billing): older CLI proxy responses nested credit usage here.
  usage: z
    .object({
      creditUsage: ApiNumberSchema.optional(),
    })
    .nullish(),
});

const GrokOidcDiscoverySchema = z.object({
  token_endpoint: z.string().url(),
});

const GrokTokenRefreshSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number().finite().optional(),
});

/**
 * Current Grok Build OIDC auth.json entry under `issuer::clientId`.
 * Access tokens live in `key` (JWT). Older entries may use `access_token`.
 */
const GrokOidcCredentialSchema = z
  .object({
    key: z.string().optional(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    auth_mode: z.string().optional(),
    expires_at: z.string().optional(),
    oidc_issuer: z.string().optional(),
    oidc_client_id: z.string().optional(),
  })
  .passthrough();

interface GrokQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  /** Override home directory (tests). Defaults to `os.homedir()`. */
  homeDir?: string;
}

interface GrokAuthRecord {
  /** Bearer token to send to the billing API. */
  token: string;
  /** Absolute path of auth.json when the token came from disk. */
  path: string | null;
  /** Map key of the credential entry (OIDC only). */
  entryKey: string | null;
  /** Parsed credential blob for refresh / write-back. */
  credential: z.infer<typeof GrokOidcCredentialSchema> | null;
  source: "auth.json" | "env";
}

function readVal(wrapper: { val?: number } | null | undefined): number | null {
  const value = wrapper?.val;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isExpiredOrNearExpiry(expiresAt: string | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs <= nowMs + GROK_AUTH_EARLY_REFRESH_MS;
}

/**
 * Resolve a Grok Build access token from env + `~/.grok/auth.json`.
 *
 * Precedence matches the CLI docs:
 * 1. Interactive OIDC session token in auth.json (takes priority over API keys)
 * 2. `XAI_API_KEY` (public xAI console key)
 * 3. `GROK_API_KEY` / `GROK_TOKEN` (legacy / fork aliases)
 */
export async function resolveGrokAccessToken(options?: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const record = await resolveGrokAuthRecord(options);
  return record?.token ?? null;
}

export async function resolveGrokAuthRecord(options?: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GrokAuthRecord | null> {
  const env = options?.env ?? process.env;
  const fromAuth = await readGrokAuthRecord(options?.homeDir);
  if (fromAuth) return fromAuth;

  const envToken =
    pickNonEmptyString(env["XAI_API_KEY"]) ||
    pickNonEmptyString(env["GROK_API_KEY"]) ||
    pickNonEmptyString(env["GROK_TOKEN"]);
  if (!envToken) return null;
  return {
    token: envToken,
    path: null,
    entryKey: null,
    credential: null,
    source: "env",
  };
}

export async function readGrokAuthToken(homeDir?: string): Promise<string | null> {
  const record = await readGrokAuthRecord(homeDir);
  return record?.token ?? null;
}

export async function readGrokAuthRecord(homeDir?: string): Promise<GrokAuthRecord | null> {
  const path = join(homeDir ?? homedir(), ".grok", "auth.json");
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path, "utf8"));
    const extracted = extractGrokAuthRecordFromJson(raw);
    if (!extracted) return null;
    return { ...extracted, path, source: "auth.json" };
  } catch {
    return null;
  }
}

/** Pure helper so unit tests can cover auth shapes without touching the filesystem. */
export function extractGrokTokenFromAuthJson(raw: unknown): string | null {
  return extractGrokAuthRecordFromJson(raw)?.token ?? null;
}

export function extractGrokAuthRecordFromJson(
  raw: unknown,
  nowMs: number = Date.now(),
): Omit<GrokAuthRecord, "path" | "source"> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  // Legacy flat file: `{ "access_token": "..." }` or `{ "key": "..." }`.
  if (!isOidcAuthMap(raw)) {
    const flat = raw as Record<string, unknown>;
    const token = pickNonEmptyString(flat.key) || pickNonEmptyString(flat.access_token);
    if (!token) return null;
    return {
      token,
      entryKey: null,
      credential: null,
    };
  }

  // OIDC map: pick the freshest usable credential entry.
  let bestFresh: Omit<GrokAuthRecord, "path" | "source"> | null = null;
  let bestExpired: Omit<GrokAuthRecord, "path" | "source"> | null = null;

  for (const [entryKey, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = GrokOidcCredentialSchema.safeParse(value);
    if (!parsed.success) continue;
    const token =
      pickNonEmptyString(parsed.data.key) || pickNonEmptyString(parsed.data.access_token);
    if (!token) continue;
    const record = {
      token,
      entryKey,
      credential: parsed.data,
    };
    if (isExpiredOrNearExpiry(parsed.data.expires_at, nowMs)) {
      bestExpired = bestExpired ?? record;
      continue;
    }
    bestFresh = bestFresh ?? record;
  }

  return bestFresh ?? bestExpired;
}

function isOidcAuthMap(raw: object): boolean {
  // OIDC auth.json is a map of `issuer::clientId` → credential objects.
  // A flat legacy file only has string token fields at the top level.
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return true;
    }
  }
  return false;
}

export class GrokQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "grok";
  readonly displayName = "Grok Build";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir?: string;

  constructor(options: GrokQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    let auth = await resolveGrokAuthRecord({ homeDir: this.homeDir });
    if (!auth) {
      return unavailableUsage({
        ...this,
        error: "Sign in with `grok login` or set XAI_API_KEY to view Grok Build usage.",
      });
    }

    // Proactively refresh OIDC sessions the way the CLI does, so billing keeps
    // working after the access JWT expires while the agent process still runs.
    if (
      auth.credential?.refresh_token &&
      isExpiredOrNearExpiry(auth.credential.expires_at, Date.now())
    ) {
      const refreshed = await this.refreshAndPersist(auth);
      if (refreshed) {
        auth = refreshed;
      }
    }

    let res = await this.callBillingApi(auth.token);

    if (res.status === 401 && auth.credential?.refresh_token) {
      const refreshed = await this.refreshAndPersist(auth);
      if (refreshed) {
        auth = refreshed;
        res = await this.callBillingApi(auth.token);
      }
    }

    if (!res.ok) {
      this.logger.debug({ status: res.status }, "Grok usage fetch failed");
      return unavailableUsage({
        ...this,
        error:
          res.status === 401
            ? "Grok session expired. Run `grok login` and refresh usage."
            : `Grok billing API returned HTTP ${res.status}.`,
      });
    }

    let resp: z.infer<typeof GrokUsageResponseSchema>;
    try {
      resp = GrokUsageResponseSchema.parse(await res.json());
    } catch (error) {
      this.logger.debug({ err: error }, "Grok usage response parse failed");
      return unavailableUsage({
        ...this,
        error: "Grok billing response could not be parsed.",
      });
    }
    return normalizeGrokUsageResponse(resp, this);
  }

  private callBillingApi(token: string): Promise<Response> {
    return fetchProviderApi(this.fetchApi, GROK_BILLING_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-XAI-Token-Auth": GROK_CLI_TOKEN_AUTH,
        Accept: "application/json",
      },
    });
  }

  private async refreshAndPersist(auth: GrokAuthRecord): Promise<GrokAuthRecord | null> {
    if (!auth.credential?.refresh_token || !auth.path || !auth.entryKey) {
      return null;
    }
    const refreshed = await this.refreshOidcToken(auth.credential);
    if (!refreshed?.access_token) {
      return null;
    }

    const expiresAt =
      typeof refreshed.expires_in === "number"
        ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        : auth.credential.expires_at;

    const nextCredential: z.infer<typeof GrokOidcCredentialSchema> = {
      ...auth.credential,
      key: refreshed.access_token,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? auth.credential.refresh_token,
      expires_at: expiresAt,
    };

    try {
      const raw = JSON.parse(await fs.readFile(auth.path, "utf8")) as Record<string, unknown>;
      raw[auth.entryKey] = nextCredential;
      await fs.writeFile(auth.path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    } catch (error) {
      this.logger.debug({ err: error }, "Failed to persist refreshed Grok credentials");
      // Still return the fresh token for this request even if write-back fails.
    }

    return {
      token: refreshed.access_token,
      path: auth.path,
      entryKey: auth.entryKey,
      credential: nextCredential,
      source: "auth.json",
    };
  }

  private async refreshOidcToken(
    credential: z.infer<typeof GrokOidcCredentialSchema>,
  ): Promise<z.infer<typeof GrokTokenRefreshSchema> | null> {
    const refreshToken = pickNonEmptyString(credential.refresh_token);
    const clientId = pickNonEmptyString(credential.oidc_client_id);
    const issuer = pickNonEmptyString(credential.oidc_issuer) ?? "https://auth.x.ai";
    if (!refreshToken || !clientId) {
      return null;
    }

    try {
      const discoveryRes = await fetchProviderApi(
        this.fetchApi,
        `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        { headers: { Accept: "application/json" } },
      );
      if (!discoveryRes.ok) {
        this.logger.debug({ status: discoveryRes.status }, "Grok OIDC discovery failed");
        return null;
      }
      const discovery = GrokOidcDiscoverySchema.parse(await discoveryRes.json());
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      });
      const tokenRes = await fetchProviderApi(this.fetchApi, discovery.token_endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!tokenRes.ok) {
        this.logger.debug({ status: tokenRes.status }, "Grok OIDC token refresh failed");
        return null;
      }
      return GrokTokenRefreshSchema.parse(await tokenRes.json());
    } catch (error) {
      this.logger.debug({ err: error }, "Grok OIDC token refresh error");
      return null;
    }
  }
}

function remainingCredits(limit: number | null, used: number | null): number | null {
  if (limit === null || used === null) return null;
  return Math.max(0, limit - used);
}

function usedPctFromCredits(limit: number | null, used: number | null): number | null {
  if (limit === null || used === null || limit <= 0) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function toneFromUsedPct(usedPct: number | null): ProviderUsageWindow["tone"] {
  if (usedPct === null) return "default";
  if (usedPct >= 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "ok";
}

function buildMonthlyCredits(
  monthlyLimit: number | null,
  creditUsage: number | null,
  periodEnd: string | null,
): { balances: ProviderUsageBalance[]; windows: ProviderUsageWindow[] } {
  if (monthlyLimit === null && creditUsage === null) {
    return { balances: [], windows: [] };
  }
  const remaining = remainingCredits(monthlyLimit, creditUsage);
  const usedPct = usedPctFromCredits(monthlyLimit, creditUsage);
  return {
    balances: [
      {
        id: "monthly_credits",
        label: "Monthly credits",
        used: creditUsage,
        remaining,
        limit: monthlyLimit,
        unit: "credits",
        tone: balanceToneFromRemaining(remaining),
      },
    ],
    windows: [
      windowFromUsedPct({
        id: "monthly",
        label: "Monthly",
        utilizationPct: usedPct,
        resetsAt: periodEnd,
        tone: toneFromUsedPct(usedPct),
      }),
    ],
  };
}

function buildOnDemandBalance(onDemandCap: number | null): ProviderUsageBalance[] {
  if (onDemandCap === null || onDemandCap <= 0) return [];
  return [
    {
      id: "on_demand_cap",
      label: "On-demand cap",
      used: null,
      remaining: onDemandCap,
      limit: onDemandCap,
      unit: "credits",
      tone: "default",
    },
  ];
}

function buildPeriodDetails(
  periodStart: string | null,
  periodEnd: string | null,
  history: NonNullable<z.infer<typeof GrokUsageResponseSchema>["config"]>["history"],
): ProviderUsageDetail[] {
  const details: ProviderUsageDetail[] = [];
  if (periodStart) {
    details.push({ id: "period_start", label: "Billing period start", value: periodStart });
  }
  if (periodEnd) {
    details.push({ id: "period_end", label: "Billing period end", value: periodEnd });
  }

  const previous = history?.[0];
  if (!previous) {
    return details;
  }
  const year = previous.billingCycle?.year;
  const month = previous.billingCycle?.month;
  if (year == null || month == null) {
    return details;
  }
  const cycleLabel = `${year}-${String(month).padStart(2, "0")}`;
  const totalUsed = readVal(previous.totalUsed);
  details.push({
    id: "previous_cycle",
    label: "Previous cycle",
    value: totalUsed === null ? cycleLabel : `${cycleLabel} · ${totalUsed} credits`,
  });
  return details;
}

function normalizeGrokUsageResponse(
  resp: z.infer<typeof GrokUsageResponseSchema>,
  provider: { providerId: string; displayName: string },
): ProviderUsage {
  const monthlyLimit = readVal(resp.config?.monthlyLimit);
  // Prefer the live `config.used` field; fall back to legacy `usage.creditUsage`.
  const creditUsage = readVal(resp.config?.used) ?? resp.usage?.creditUsage ?? null;
  const onDemandCap = readVal(resp.config?.onDemandCap);
  const periodStart = resp.config?.billingPeriodStart ?? null;
  const periodEnd = resp.config?.billingPeriodEnd ?? null;

  const monthly = buildMonthlyCredits(monthlyLimit, creditUsage, periodEnd);
  const balances = [...monthly.balances, ...buildOnDemandBalance(onDemandCap)];
  const windows = monthly.windows;
  const details = buildPeriodDetails(periodStart, periodEnd, resp.config?.history);

  if (balances.length === 0 && windows.length === 0) {
    return unavailableUsage(provider);
  }

  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    status: "available",
    planLabel: "Grok Build",
    windows,
    balances,
    details,
    error: null,
  };
}
