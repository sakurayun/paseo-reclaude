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
  toneFromUsedPct,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

/** Plain monthly absolute-credits endpoint (older / non-unified payloads). */
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
/**
 * What Grok CLI `/usage` actually hits. SuperGrok rate limits surface here as a
 * rolling `currentPeriod` (WEEKLY or MONTHLY) + `creditUsagePercent`.
 */
const GROK_BILLING_CREDITS_URL = `${GROK_BILLING_URL}?format=credits`;
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
 * Rolling usage window on the credits-format payload.
 * SuperGrok accounts report `USAGE_PERIOD_TYPE_WEEKLY`; some plans are monthly.
 */
const GrokUsagePeriodSchema = z
  .object({
    type: z.string().nullish(),
    start: z.string().nullish(),
    end: z.string().nullish(),
  })
  .nullish();

/**
 * Live Grok Build billing shape (2026-07+).
 *
 * Two wire shapes share this schema:
 * 1. `GET /v1/billing?format=credits` (CLI `/usage`) — SuperGrok weekly (or monthly)
 *    rate limit via `config.creditUsagePercent` + `config.currentPeriod`, plus
 *    optional on-demand / prepaid / subscription tier.
 * 2. `GET /v1/billing` — absolute monthly included credits under `config.used` /
 *    `config.monthlyLimit` (and the older `usage.creditUsage` nest).
 *
 * Both are accepted so caches, mocks, and dual-fetch merges keep working.
 */
const GrokUsageResponseSchema = z.object({
  config: z
    .object({
      monthlyLimit: GrokValSchema,
      used: GrokValSchema,
      // Credits-format SuperGrok fields (CLI `/usage`).
      creditUsagePercent: ApiNumberSchema.optional(),
      currentPeriod: GrokUsagePeriodSchema,
      onDemandCap: GrokValSchema,
      onDemandUsed: GrokValSchema,
      prepaidBalance: GrokValSchema,
      isUnifiedBillingUser: z.boolean().nullish(),
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
  // Top-level plan signal from the credits-format response (e.g. "SuperGrok").
  subscriptionTier: z.union([z.string(), z.array(z.string())]).nullish(),
  subscription_tier: z.string().nullish(),
  onDemandEnabled: z.boolean().nullish(),
});

type GrokUsageResponse = z.infer<typeof GrokUsageResponseSchema>;
type GrokPeriodKind = "weekly" | "monthly" | "unknown";
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

    let snapshots = await this.fetchBillingSnapshots(auth.token);

    if (snapshots.primaryStatus === 401 && auth.credential?.refresh_token) {
      const refreshed = await this.refreshAndPersist(auth);
      if (refreshed) {
        auth = refreshed;
        snapshots = await this.fetchBillingSnapshots(auth.token);
      }
    }

    if (!snapshots.credits && !snapshots.legacy) {
      this.logger.debug({ status: snapshots.primaryStatus }, "Grok usage fetch failed");
      return unavailableUsage({
        ...this,
        error: grokBillingErrorMessage(snapshots.primaryStatus),
      });
    }

    return normalizeGrokUsageResponse(snapshots, this);
  }
  /**
   * Hit both billing wire shapes in parallel:
   * - `?format=credits` → SuperGrok weekly/monthly rate-limit percent (CLI `/usage`)
   * - plain `/v1/billing` → absolute monthly included credits
   */
  private async fetchBillingSnapshots(token: string): Promise<GrokBillingSnapshots> {
    const [creditsOutcome, legacyOutcome] = await Promise.all([
      this.fetchParsedBilling(token, true),
      this.fetchParsedBilling(token, false),
    ]);
    return {
      credits: creditsOutcome.parsed,
      legacy: legacyOutcome.parsed,
      // Prefer the credits endpoint status for error messaging (what the CLI uses).
      primaryStatus: creditsOutcome.status ?? legacyOutcome.status,
    };
  }

  private async fetchParsedBilling(
    token: string,
    formatCredits: boolean,
  ): Promise<{ status: number | null; parsed: GrokUsageResponse | null }> {
    try {
      const res = await this.callBillingApi(token, formatCredits);
      if (!res.ok) {
        return { status: res.status, parsed: null };
      }
      try {
        return {
          status: res.status,
          parsed: GrokUsageResponseSchema.parse(await res.json()),
        };
      } catch (error) {
        this.logger.debug({ err: error, formatCredits }, "Grok usage response parse failed");
        return { status: res.status, parsed: null };
      }
    } catch (error) {
      this.logger.debug({ err: error, formatCredits }, "Grok usage fetch error");
      return { status: null, parsed: null };
    }
  }

  private callBillingApi(token: string, formatCredits: boolean): Promise<Response> {
    return fetchProviderApi(
      this.fetchApi,
      formatCredits ? GROK_BILLING_CREDITS_URL : GROK_BILLING_URL,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-XAI-Token-Auth": GROK_CLI_TOKEN_AUTH,
          Accept: "application/json",
        },
      },
    );
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

interface GrokBillingSnapshots {
  credits: GrokUsageResponse | null;
  legacy: GrokUsageResponse | null;
  primaryStatus: number | null;
}

function remainingCredits(limit: number | null, used: number | null): number | null {
  if (limit === null || used === null) return null;
  return Math.max(0, limit - used);
}

function usedPctFromCredits(limit: number | null, used: number | null): number | null {
  if (limit === null || used === null || limit <= 0) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function clampUsagePercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

/**
 * Map Grok's `USAGE_PERIOD_TYPE_*` (and short aliases) onto our generic window ids.
 * Unknown types still produce a window labeled from the raw type when possible.
 */
function classifyGrokPeriodType(type: string | null | undefined): GrokPeriodKind {
  if (!type) return "unknown";
  const normalized = type.trim().toUpperCase();
  if (normalized.includes("WEEK")) return "weekly";
  if (normalized.includes("MONTH")) return "monthly";
  return "unknown";
}

function pickFirstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function resolveSubscriptionLabel(resp: GrokUsageResponse): string | null {
  const tiers = resp.subscriptionTier;
  if (typeof tiers === "string" && tiers.trim()) return tiers.trim();
  if (Array.isArray(tiers)) {
    const joined = tiers
      .map((tier) => (typeof tier === "string" ? tier.trim() : ""))
      .filter(Boolean)
      .join(", ");
    if (joined) return joined;
  }
  return pickFirstString(resp.subscription_tier);
}

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function buildPeriodWindow(input: {
  kind: GrokPeriodKind;
  usedPct: number | null;
  resetsAt: string | null;
}): ProviderUsageWindow | null {
  if (input.usedPct === null && input.kind === "unknown") return null;
  if (input.kind === "weekly") {
    const window = windowFromUsedPct({
      id: "weekly",
      label: "Weekly",
      utilizationPct: input.usedPct,
      resetsAt: input.resetsAt,
      tone: toneFromUsedPct(input.usedPct),
    });
    // Full d/h/m countdown in the compact tooltip — optional on the protocol.
    window.fullCountdown = true;
    return window;
  }
  if (input.kind === "monthly") {
    return windowFromUsedPct({
      id: "monthly",
      label: "Monthly",
      utilizationPct: input.usedPct,
      resetsAt: input.resetsAt,
      tone: toneFromUsedPct(input.usedPct),
    });
  }
  // Unknown period type — still surface the percent under a neutral label.
  return windowFromUsedPct({
    id: "plan_usage",
    label: "Plan usage",
    utilizationPct: input.usedPct,
    resetsAt: input.resetsAt,
    tone: toneFromUsedPct(input.usedPct),
  });
}

function buildMonthlyCreditsBalance(
  monthlyLimit: number | null,
  creditUsage: number | null,
  periodEnd: string | null,
): ProviderUsageBalance | null {
  if (monthlyLimit === null && creditUsage === null) return null;
  const remaining = remainingCredits(monthlyLimit, creditUsage);
  const usedPct = usedPctFromCredits(monthlyLimit, creditUsage);
  return {
    id: "monthly_credits",
    label: "Monthly credits",
    used: creditUsage,
    remaining,
    limit: monthlyLimit,
    unit: "credits",
    resetsAt: periodEnd,
    tone: usedPct != null ? toneFromUsedPct(usedPct) : balanceToneFromRemaining(remaining),
  };
}

function buildOnDemandBalances(
  onDemandCap: number | null,
  onDemandUsed: number | null,
): ProviderUsageBalance[] {
  if (onDemandCap === null || onDemandCap <= 0) return [];
  const remaining = onDemandUsed === null ? onDemandCap : Math.max(0, onDemandCap - onDemandUsed);
  const usedPct = usedPctFromCredits(onDemandCap, onDemandUsed);
  return [
    {
      id: "on_demand_cap",
      label: "On-demand cap",
      used: onDemandUsed,
      remaining,
      limit: onDemandCap,
      unit: "credits",
      tone: usedPct != null ? toneFromUsedPct(usedPct) : "default",
    },
  ];
}

function buildPrepaidBalance(prepaid: number | null): ProviderUsageBalance[] {
  if (prepaid === null || prepaid <= 0) return [];
  return [
    {
      id: "prepaid_balance",
      label: "Prepaid credits",
      used: null,
      remaining: prepaid,
      limit: null,
      unit: "credits",
      tone: balanceToneFromRemaining(prepaid),
    },
  ];
}

function buildPeriodDetails(input: {
  periodStart: string | null;
  periodEnd: string | null;
  periodKind: GrokPeriodKind;
  history: NonNullable<GrokUsageResponse["config"]>["history"];
  subscriptionLabel: string | null;
  isUnified: boolean | null | undefined;
}): ProviderUsageDetail[] {
  const details: ProviderUsageDetail[] = [];
  if (input.subscriptionLabel) {
    details.push({
      id: "subscription",
      label: "Plan",
      value: input.subscriptionLabel,
    });
  }
  if (input.periodKind === "weekly" || input.periodKind === "monthly") {
    details.push({
      id: "current_period",
      label: "Current period",
      value: input.periodKind === "weekly" ? "Weekly" : "Monthly",
    });
  }
  if (input.periodStart) {
    details.push({
      id: "period_start",
      label: input.periodKind === "weekly" ? "Week starts" : "Billing period start",
      value: input.periodStart,
    });
  }
  if (input.periodEnd) {
    details.push({
      id: "period_end",
      label: input.periodKind === "weekly" ? "Week resets" : "Billing period end",
      value: input.periodEnd,
    });
  }
  if (input.isUnified === true) {
    details.push({
      id: "unified_billing",
      label: "Billing",
      value: "Unified",
    });
  }

  const previous = input.history?.[0];
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

interface GrokResolvedFields {
  monthlyLimit: number | null;
  creditUsage: number | null;
  onDemandCap: number | null;
  onDemandUsed: number | null;
  prepaidBalance: number | null;
  currentPeriod: NonNullable<NonNullable<GrokUsageResponse["config"]>["currentPeriod"]> | null;
  periodKind: GrokPeriodKind;
  rollingStart: string | null;
  rollingEnd: string | null;
  monthlyPeriodEnd: string | null;
  creditUsagePercent: number | null;
  subscriptionLabel: string | null;
  history: NonNullable<GrokUsageResponse["config"]>["history"];
  isUnified: boolean | null | undefined;
}

function configVal(
  creditsConfig: GrokUsageResponse["config"],
  legacyConfig: GrokUsageResponse["config"],
  key: "monthlyLimit" | "used" | "onDemandCap" | "onDemandUsed" | "prepaidBalance",
): number | null {
  return pickNumber(readVal(creditsConfig?.[key]), readVal(legacyConfig?.[key]));
}

function resolvePeriodFields(
  creditsConfig: GrokUsageResponse["config"],
  legacyConfig: GrokUsageResponse["config"],
): Pick<
  GrokResolvedFields,
  | "currentPeriod"
  | "periodKind"
  | "rollingStart"
  | "rollingEnd"
  | "monthlyPeriodEnd"
  | "creditUsagePercent"
> {
  const creditUsagePercent = clampUsagePercent(
    creditsConfig?.creditUsagePercent ?? legacyConfig?.creditUsagePercent,
  );
  const currentPeriod = creditsConfig?.currentPeriod ?? legacyConfig?.currentPeriod ?? null;
  let periodKind = classifyGrokPeriodType(currentPeriod?.type ?? null);
  if (periodKind === "unknown" && creditUsagePercent != null) {
    periodKind = "weekly";
  }
  const rollingStart = pickFirstString(currentPeriod?.start, creditsConfig?.billingPeriodStart);
  const rollingEnd = pickFirstString(currentPeriod?.end, creditsConfig?.billingPeriodEnd);
  const monthlyPeriodEnd =
    periodKind === "monthly"
      ? pickFirstString(rollingEnd, legacyConfig?.billingPeriodEnd, creditsConfig?.billingPeriodEnd)
      : pickFirstString(legacyConfig?.billingPeriodEnd);
  return {
    currentPeriod,
    periodKind,
    rollingStart,
    rollingEnd,
    monthlyPeriodEnd,
    creditUsagePercent,
  };
}

function resolveGrokFields(
  credits: GrokUsageResponse | null,
  legacy: GrokUsageResponse | null,
): GrokResolvedFields {
  const creditsConfig = credits?.config;
  const legacyConfig = legacy?.config;
  const period = resolvePeriodFields(creditsConfig, legacyConfig);
  return {
    monthlyLimit: configVal(creditsConfig, legacyConfig, "monthlyLimit"),
    creditUsage: pickNumber(
      readVal(creditsConfig?.used),
      credits?.usage?.creditUsage,
      readVal(legacyConfig?.used),
      legacy?.usage?.creditUsage,
    ),
    onDemandCap: configVal(creditsConfig, legacyConfig, "onDemandCap"),
    onDemandUsed: configVal(creditsConfig, legacyConfig, "onDemandUsed"),
    prepaidBalance: configVal(creditsConfig, legacyConfig, "prepaidBalance"),
    ...period,
    subscriptionLabel:
      resolveSubscriptionLabel(credits ?? {}) ?? resolveSubscriptionLabel(legacy ?? {}),
    history: creditsConfig?.history ?? legacyConfig?.history,
    isUnified: creditsConfig?.isUnifiedBillingUser ?? legacyConfig?.isUnifiedBillingUser,
  };
}

function buildGrokWindows(fields: GrokResolvedFields): ProviderUsageWindow[] {
  const windows: ProviderUsageWindow[] = [];
  const windowIds = new Set<string>();

  // 1) Credits-format rolling window (weekly SuperGrok limit is the common case).
  if (fields.creditUsagePercent != null || fields.currentPeriod) {
    const periodWindow = buildPeriodWindow({
      kind: fields.periodKind,
      usedPct: fields.creditUsagePercent,
      resetsAt: fields.rollingEnd,
    });
    if (periodWindow && !windowIds.has(periodWindow.id)) {
      windows.push(periodWindow);
      windowIds.add(periodWindow.id);
    }
  }

  // 2) Absolute monthly included credits. When the rolling period is already
  // monthly from creditUsagePercent, absolute numbers only feed the balance.
  // When it's weekly (or missing), also emit a separate Monthly window.
  const shouldAddMonthlyWindow =
    !windowIds.has("monthly") &&
    fields.monthlyLimit != null &&
    fields.creditUsage != null &&
    (fields.periodKind !== "monthly" || fields.creditUsagePercent == null);
  if (shouldAddMonthlyWindow) {
    const usedPct = usedPctFromCredits(fields.monthlyLimit, fields.creditUsage);
    windows.push(
      windowFromUsedPct({
        id: "monthly",
        label: "Monthly",
        utilizationPct: usedPct,
        resetsAt: fields.monthlyPeriodEnd,
        tone: toneFromUsedPct(usedPct),
      }),
    );
  }

  return windows;
}

function grokBillingErrorMessage(status: number | null): string {
  if (status === 401) {
    return "Grok session expired. Run `grok login` and refresh usage.";
  }
  if (status != null) {
    return `Grok billing API returned HTTP ${status}.`;
  }
  return "Grok billing response could not be parsed.";
}

/**
 * Prefer credits-format fields (weekly SuperGrok) and fill absolute monthly
 * credits / calendar bounds from the plain `/v1/billing` payload.
 */
function normalizeGrokUsageResponse(
  snapshots: GrokBillingSnapshots,
  provider: { providerId: string; displayName: string },
): ProviderUsage {
  if (!snapshots.credits && !snapshots.legacy) {
    return unavailableUsage(provider);
  }

  const fields = resolveGrokFields(snapshots.credits, snapshots.legacy);
  const windows = buildGrokWindows(fields);
  const monthlyBalance = buildMonthlyCreditsBalance(
    fields.monthlyLimit,
    fields.creditUsage,
    fields.monthlyPeriodEnd,
  );
  const balances: ProviderUsageBalance[] = [
    ...(monthlyBalance ? [monthlyBalance] : []),
    ...buildPrepaidBalance(fields.prepaidBalance),
    ...buildOnDemandBalances(fields.onDemandCap, fields.onDemandUsed),
  ];
  const details = buildPeriodDetails({
    periodStart: fields.rollingStart,
    periodEnd: fields.rollingEnd,
    periodKind: fields.periodKind,
    history: fields.history,
    subscriptionLabel: fields.subscriptionLabel,
    isUnified: fields.isUnified,
  });

  if (balances.length === 0 && windows.length === 0) {
    return unavailableUsage(provider);
  }

  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    status: "available",
    planLabel: fields.subscriptionLabel ?? "Grok Build",
    windows,
    balances,
    details,
    error: null,
  };
}
