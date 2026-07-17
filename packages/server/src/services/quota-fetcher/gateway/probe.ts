import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type { ProviderApiFetch } from "../provider.js";
import {
  ApiNumberSchema,
  balanceToneFromRemaining,
  fetchProviderApi,
  windowFromUsedPct,
} from "../usage.js";
import { newApiQuotaToUsd, type GatewayAuthCredentials } from "./resolve-auth.js";

/** Browser-like UA so Cloudflare-fronted NewAPI / Sub2API hosts accept the probe. */
const GATEWAY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export type GatewayKind = "newapi" | "sub2api" | "cpa";

const NewApiTokenUsageSchema = z.object({
  code: z.union([z.boolean(), z.number()]).optional(),
  success: z.boolean().optional(),
  data: z
    .object({
      object: z.string().optional(),
      name: z.string().optional(),
      total_granted: ApiNumberSchema.optional(),
      total_used: ApiNumberSchema.optional(),
      total_available: ApiNumberSchema.optional(),
      unlimited_quota: z.boolean().optional(),
      expires_at: ApiNumberSchema.optional(),
    })
    .optional(),
  message: z.string().optional(),
});

const Sub2ApiQuotaSchema = z.object({
  limit: ApiNumberSchema.optional(),
  used: ApiNumberSchema.optional(),
  remaining: ApiNumberSchema.optional(),
  unit: z.string().optional(),
});

const Sub2ApiRateLimitSchema = z.object({
  window: z.string().optional(),
  limit: ApiNumberSchema.optional(),
  used: ApiNumberSchema.optional(),
  remaining: ApiNumberSchema.optional(),
});

const Sub2ApiUsageSchema = z.object({
  mode: z.string().optional(),
  isValid: z.boolean().optional(),
  status: z.union([z.string(), z.number()]).optional(),
  planName: z.string().optional(),
  unit: z.string().optional(),
  remaining: ApiNumberSchema.optional(),
  quota: Sub2ApiQuotaSchema.optional(),
  rate_limits: z.array(Sub2ApiRateLimitSchema).optional(),
  rateLimits: z.array(Sub2ApiRateLimitSchema).optional(),
  subscription: z
    .object({
      daily_usage_usd: ApiNumberSchema.optional(),
      weekly_usage_usd: ApiNumberSchema.optional(),
      monthly_usage_usd: ApiNumberSchema.optional(),
      daily_limit_usd: ApiNumberSchema.optional(),
      weekly_limit_usd: ApiNumberSchema.optional(),
      monthly_limit_usd: ApiNumberSchema.optional(),
    })
    .optional(),
});

const CpaAuthFilesSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().optional(),
        provider: z.string().optional(),
        type: z.string().optional(),
        status: z.union([z.string(), z.number()]).optional(),
        disabled: z.boolean().optional(),
        unavailable: z.boolean().optional(),
        email: z.string().optional(),
        id_token: z
          .object({
            plan_type: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export interface ProbeGatewayUsageOptions {
  auth: GatewayAuthCredentials;
  providerId: string;
  displayName: string;
  fetchApi: ProviderApiFetch;
  logger: Logger;
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

/**
 * Build candidate request roots from a client-facing base URL.
 * Clients often set `https://host/v1` or `https://host/v1/` — strip common API suffixes
 * so `/api/usage/token` and `/v1/usage` land on the real host root.
 */
function candidateRoots(baseUrl: string): string[] {
  const roots = new Set<string>();
  roots.add(baseUrl);
  roots.add(originOf(baseUrl));

  try {
    const url = new URL(baseUrl);
    let path = url.pathname.replace(/\/+$/, "");
    for (const suffix of ["/v1", "/api/v1", "/api", "/openai", "/openai/v1"]) {
      if (path.toLowerCase().endsWith(suffix)) {
        path = path.slice(0, -suffix.length);
        url.pathname = path || "/";
        let href = url.toString();
        if (href.endsWith("/")) href = href.slice(0, -1);
        roots.add(href === "" ? url.origin : href);
        roots.add(url.origin);
      }
    }
  } catch {
    // ignore
  }

  return [...roots];
}

function withV1(root: string): string {
  if (/\/v1$/i.test(root)) return root;
  return `${root}/v1`;
}

async function getJson(
  fetchApi: ProviderApiFetch,
  url: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetchProviderApi(fetchApi, url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": GATEWAY_USER_AGENT,
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

function mapNewApiUsage(
  data: NonNullable<z.infer<typeof NewApiTokenUsageSchema>["data"]>,
  options: ProbeGatewayUsageOptions,
): ProviderUsage {
  const unlimited = data.unlimited_quota === true;
  const totalGranted = data.total_granted ?? null;
  const totalUsed = data.total_used ?? null;
  const totalAvailable = data.total_available ?? null;

  const balances: ProviderUsageBalance[] = [];
  const details: ProviderUsageDetail[] = [];

  if (data.name) {
    details.push({ id: "token_name", label: "Token", value: data.name });
  }
  details.push({ id: "gateway", label: "Gateway", value: "NewAPI" });

  if (unlimited) {
    if (typeof totalUsed === "number") {
      const usedUsd = newApiQuotaToUsd(totalUsed);
      balances.push({
        id: "used",
        label: "Used",
        used: usedUsd,
        remaining: null,
        limit: null,
        unit: "usd",
        tone: "default",
      });
    }
    return {
      providerId: options.providerId,
      displayName: options.displayName,
      status: "available",
      planLabel: "NewAPI · Unlimited",
      windows: [],
      balances,
      details,
      error: null,
    };
  }

  // Limited quota: convert new-api points → USD for display.
  const grantedUsd = typeof totalGranted === "number" ? newApiQuotaToUsd(totalGranted) : null;
  const usedUsd = typeof totalUsed === "number" ? newApiQuotaToUsd(totalUsed) : null;
  const availableUsd =
    typeof totalAvailable === "number" ? Math.max(0, newApiQuotaToUsd(totalAvailable)) : null;

  balances.push({
    id: "quota",
    label: "Quota",
    used: usedUsd,
    remaining: availableUsd,
    limit: grantedUsd,
    unit: "usd",
    tone: balanceToneFromRemaining(availableUsd),
  });

  return {
    providerId: options.providerId,
    displayName: options.displayName,
    status: "available",
    planLabel: "NewAPI",
    windows: [],
    balances,
    details,
    error: null,
  };
}

function rateLimitWindowLabel(windowId: string): string {
  if (windowId === "5h") return "5 hour";
  if (windowId === "1d") return "Daily";
  if (windowId === "7d") return "Weekly";
  return windowId;
}

function pushUsedLimitWindow(
  windows: ProviderUsageWindow[],
  id: string,
  label: string,
  used: number | undefined,
  limit: number | undefined,
): void {
  if (typeof limit !== "number" || limit <= 0 || typeof used !== "number") {
    return;
  }
  const usedPct = Math.min(100, Math.max(0, (used / limit) * 100));
  windows.push(
    windowFromUsedPct({
      id,
      label,
      utilizationPct: usedPct,
      tone: usedPct >= 90 ? "warning" : "ok",
    }),
  );
}

function mapSub2ApiUsage(
  data: z.infer<typeof Sub2ApiUsageSchema>,
  options: ProbeGatewayUsageOptions,
): ProviderUsage {
  const balances: ProviderUsageBalance[] = [];
  const windows: ProviderUsageWindow[] = [];
  const details: ProviderUsageDetail[] = [{ id: "gateway", label: "Gateway", value: "Sub2API" }];

  if (data.quota && (data.quota.limit || data.quota.remaining != null || data.quota.used != null)) {
    balances.push({
      id: "quota",
      label: "Quota",
      used: data.quota.used ?? null,
      remaining: data.quota.remaining ?? null,
      limit: data.quota.limit ?? null,
      unit: "usd",
      tone: balanceToneFromRemaining(data.quota.remaining),
    });
  } else if (typeof data.remaining === "number") {
    balances.push({
      id: "remaining",
      label: "Remaining",
      remaining: data.remaining,
      unit: "usd",
      tone: balanceToneFromRemaining(data.remaining),
    });
  }

  const rateLimits = data.rate_limits ?? data.rateLimits ?? [];
  for (const rl of rateLimits) {
    const windowId = (rl.window ?? "window").toLowerCase();
    pushUsedLimitWindow(
      windows,
      `rate_${windowId}`,
      rateLimitWindowLabel(windowId),
      rl.used,
      rl.limit,
    );
  }

  if (data.subscription) {
    const sub = data.subscription;
    pushUsedLimitWindow(windows, "sub_daily", "Daily", sub.daily_usage_usd, sub.daily_limit_usd);
    pushUsedLimitWindow(
      windows,
      "sub_weekly",
      "Weekly",
      sub.weekly_usage_usd,
      sub.weekly_limit_usd,
    );
    pushUsedLimitWindow(
      windows,
      "sub_monthly",
      "Monthly",
      sub.monthly_usage_usd,
      sub.monthly_limit_usd,
    );
  }

  const hasSignal = balances.length > 0 || windows.length > 0;
  return {
    providerId: options.providerId,
    displayName: options.displayName,
    status: hasSignal ? "available" : "unavailable",
    planLabel: data.planName ? `Sub2API · ${data.planName}` : "Sub2API",
    windows,
    balances,
    details,
    error: null,
  };
}

function mapCpaAuthFiles(
  data: z.infer<typeof CpaAuthFilesSchema>,
  options: ProbeGatewayUsageOptions,
): ProviderUsage {
  const files = (data.files ?? []).filter((f) => !f.disabled);
  const details: ProviderUsageDetail[] = [
    { id: "gateway", label: "Gateway", value: "CPA (CLIProxyAPI)" },
    {
      id: "accounts",
      label: "Accounts",
      value: String(files.length),
    },
  ];

  const byProvider = new Map<string, number>();
  for (const file of files) {
    const provider = (file.provider || file.type || "unknown").toLowerCase();
    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    if (file.email) {
      details.push({
        id: `account_${file.name ?? file.email}`,
        label: provider,
        value: file.email + (file.id_token?.plan_type ? ` · ${file.id_token.plan_type}` : ""),
      });
    } else if (file.id_token?.plan_type) {
      details.push({
        id: `plan_${file.name ?? provider}`,
        label: provider,
        value: file.id_token.plan_type,
      });
    }
  }

  for (const [provider, count] of byProvider) {
    details.push({
      id: `count_${provider}`,
      label: `${provider} accounts`,
      value: String(count),
    });
  }

  return {
    providerId: options.providerId,
    displayName: options.displayName,
    status: files.length > 0 ? "available" : "unavailable",
    planLabel: files.length > 0 ? `CPA · ${files.length} account(s)` : "CPA",
    windows: [],
    balances: [],
    details,
    error: null,
  };
}

async function tryNewApi(
  roots: string[],
  options: ProbeGatewayUsageOptions,
): Promise<ProviderUsage | null> {
  for (const root of roots) {
    const url = `${root}/api/usage/token`;
    try {
      const { ok, status, json } = await getJson(options.fetchApi, url, options.auth.apiKey);
      if (!ok || status === 404) continue;
      const parsed = NewApiTokenUsageSchema.safeParse(json);
      if (!parsed.success || !parsed.data.data) continue;
      // Require token_usage shape or at least total_* fields so random 200 HTML/JSON is ignored.
      const data = parsed.data.data;
      if (
        data.object !== "token_usage" &&
        data.total_used == null &&
        data.total_available == null &&
        data.total_granted == null
      ) {
        continue;
      }
      options.logger.debug({ url, source: options.auth.source }, "NewAPI usage probe succeeded");
      return mapNewApiUsage(data, options);
    } catch (error) {
      options.logger.debug({ err: error, url }, "NewAPI usage probe failed");
    }
  }
  return null;
}

async function trySub2Api(
  roots: string[],
  options: ProbeGatewayUsageOptions,
): Promise<ProviderUsage | null> {
  const urls = new Set<string>();
  for (const root of roots) {
    urls.add(`${withV1(root)}/usage`);
    urls.add(`${root}/v1/usage`);
  }
  for (const url of urls) {
    try {
      const { ok, status, json } = await getJson(options.fetchApi, url, options.auth.apiKey);
      if (!ok || status === 404) continue;
      const parsed = Sub2ApiUsageSchema.safeParse(json);
      if (!parsed.success) continue;
      // Sub2API responses include mode / quota / rate_limits — require at least one signal.
      const data = parsed.data;
      if (
        !data.mode &&
        !data.quota &&
        !data.rate_limits &&
        !data.rateLimits &&
        data.remaining == null &&
        !data.subscription
      ) {
        continue;
      }
      options.logger.debug({ url, source: options.auth.source }, "Sub2API usage probe succeeded");
      return mapSub2ApiUsage(data, options);
    } catch (error) {
      options.logger.debug({ err: error, url }, "Sub2API usage probe failed");
    }
  }
  return null;
}

async function tryCpa(
  roots: string[],
  options: ProbeGatewayUsageOptions,
): Promise<ProviderUsage | null> {
  // CPA management API: Authorization: Bearer <management-key>
  // End users sometimes paste the same key used for /v1 into Claude/Codex settings.
  const urls = new Set<string>();
  for (const root of roots) {
    urls.add(`${originOf(root)}/v0/management/auth-files`);
    urls.add(`${root}/v0/management/auth-files`);
  }
  for (const url of urls) {
    try {
      const { ok, status, json } = await getJson(options.fetchApi, url, options.auth.apiKey);
      if (!ok || status === 401 || status === 403 || status === 404) continue;
      const parsed = CpaAuthFilesSchema.safeParse(json);
      if (!parsed.success || !parsed.data.files) continue;
      options.logger.debug({ url, source: options.auth.source }, "CPA usage probe succeeded");
      return mapCpaAuthFiles(parsed.data, options);
    } catch (error) {
      options.logger.debug({ err: error, url }, "CPA usage probe failed");
    }
  }
  return null;
}

export const GATEWAY_KIND_LABELS: Record<GatewayKind, string> = {
  newapi: "NewAPI",
  sub2api: "Sub2API",
  cpa: "CPA",
};

export interface GatewayProbeResult {
  kind: GatewayKind;
  label: string;
  usage: ProviderUsage | null;
  error: string | null;
}

function unavailableGatewayUsage(
  options: ProbeGatewayUsageOptions,
  kind: GatewayKind,
  error: string | null,
): ProviderUsage {
  return {
    providerId: options.providerId,
    displayName: options.displayName,
    status: error ? "error" : "unavailable",
    planLabel: GATEWAY_KIND_LABELS[kind],
    windows: [],
    balances: [],
    details: [{ id: "gateway", label: "Gateway", value: GATEWAY_KIND_LABELS[kind] }],
    error,
  };
}

/**
 * Probe a single gateway kind. Returns null when the host doesn't look like that
 * gateway (404 / wrong shape). Throws network/parse errors as `error` strings
 * via the result wrapper used by {@link probeAllGatewayKinds}.
 */
export async function probeGatewayKind(
  kind: GatewayKind,
  options: ProbeGatewayUsageOptions,
): Promise<ProviderUsage | null> {
  const roots = candidateRoots(options.auth.baseUrl);
  if (kind === "newapi") return tryNewApi(roots, options);
  if (kind === "sub2api") return trySub2Api(roots, options);
  return tryCpa(roots, options);
}

/**
 * Probe all known gateways in parallel and return per-kind snapshots (including
 * unavailable ones) so the UI can show a NewAPI / Sub2API / CPA tab switcher.
 */
export async function probeAllGatewayKinds(
  options: ProbeGatewayUsageOptions,
): Promise<GatewayProbeResult[]> {
  const roots = candidateRoots(options.auth.baseUrl);
  options.logger.debug(
    { roots, source: options.auth.source, providerId: options.providerId },
    "Probing all third-party gateway usage sources",
  );

  const kinds: GatewayKind[] = ["newapi", "sub2api", "cpa"];
  const settled = await Promise.all(
    kinds.map(async (kind): Promise<GatewayProbeResult> => {
      try {
        const usage = await probeGatewayKind(kind, options);
        return {
          kind,
          label: GATEWAY_KIND_LABELS[kind],
          usage,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger.debug({ err: error, kind }, "Gateway kind probe threw");
        return {
          kind,
          label: GATEWAY_KIND_LABELS[kind],
          usage: unavailableGatewayUsage(options, kind, message),
          error: message,
        };
      }
    }),
  );

  return settled;
}

/**
 * Probe a custom Claude/Codex base URL + API key for known gateway usage APIs.
 * Returns the first available match (NewAPI → Sub2API → CPA) or null.
 */
export async function probeGatewayUsage(
  options: ProbeGatewayUsageOptions,
): Promise<ProviderUsage | null> {
  const results = await probeAllGatewayKinds(options);
  for (const result of results) {
    if (result.usage?.status === "available") {
      return result.usage;
    }
  }
  return null;
}

/**
 * Project a multi-source usage object: pick the best available source for the
 * top-level fields, attach full `sources` for client tab switching.
 */
export function assembleMultiSourceUsage(input: {
  providerId: string;
  displayName: string;
  official?: ProviderUsage | null;
  gatewayResults?: GatewayProbeResult[];
}): ProviderUsage {
  const sources: NonNullable<ProviderUsage["sources"]> = [];

  if (input.official) {
    sources.push({
      kind: "official",
      label: "Official",
      status: input.official.status,
      planLabel: input.official.planLabel,
      windows: input.official.windows,
      balances: input.official.balances,
      details: input.official.details,
      error: input.official.error,
    });
  }

  if (input.gatewayResults) {
    for (const result of input.gatewayResults) {
      if (result.usage) {
        sources.push({
          kind: result.kind,
          label: result.label,
          status: result.usage.status,
          planLabel: result.usage.planLabel,
          windows: result.usage.windows,
          balances: result.usage.balances,
          details: result.usage.details,
          error: result.usage.error ?? result.error,
        });
      } else {
        sources.push({
          kind: result.kind,
          label: result.label,
          status: "unavailable",
          planLabel: result.label,
          windows: [],
          balances: [],
          details: [{ id: "gateway", label: "Gateway", value: result.label }],
          error: result.error,
        });
      }
    }
  }

  // Prefer official when available; otherwise first available gateway; else first tab.
  const preferred =
    sources.find((s) => s.kind === "official" && s.status === "available") ??
    sources.find((s) => s.status === "available") ??
    sources[0] ??
    null;

  if (!preferred) {
    return {
      providerId: input.providerId,
      displayName: input.displayName,
      status: "unavailable",
      planLabel: null,
      windows: [],
      balances: [],
      details: [],
      error: null,
      sources: [],
    };
  }

  return {
    providerId: input.providerId,
    displayName: input.displayName,
    status: preferred.status,
    planLabel: preferred.planLabel,
    sourceLabel: preferred.label,
    windows: preferred.windows,
    balances: preferred.balances,
    details: preferred.details,
    // Never leave a stale ChatGPT-auth error on a gateway-available selection.
    error: preferred.status === "available" ? null : (preferred.error ?? null),
    selectedSourceKind: preferred.kind,
    sources,
    availableResetCredits: input.official?.availableResetCredits,
    rateLimitReached: input.official?.rateLimitReached,
  };
}
