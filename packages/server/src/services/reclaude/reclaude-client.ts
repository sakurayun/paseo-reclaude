import { z } from "zod";

import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageWindow,
} from "../../server/messages.js";
import type { ProviderApiFetch } from "../quota-fetcher/provider.js";
import {
  ApiNullableNumberSchema,
  balanceToneFromRemaining,
  fetchProviderApi,
  windowFromUsedPct,
} from "../quota-fetcher/usage.js";

// reclaude.ai login + usage client. Auth is cookie-based: POST /api/auth/login
// sets an `rc_sid` session cookie (HttpOnly), which we capture and replay on
// subsequent requests. A browser-like User-Agent is required to get past
// Cloudflare. See docs/reclaude-integration.md for the reverse-engineered API.
const RECLAUDE_BASE_URL = "https://www.reclaude.ai";
const RECLAUDE_SESSION_COOKIE = "rc_sid";
const RECLAUDE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const ReclaudeLoginResponseSchema = z.object({
  step: z.enum(["completed", "mfa_required"]).optional(),
  mfa_challenge_token: z.string().nullish(),
});

const ReclaudeErrorBodySchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
});

const ReclaudeUsageWindowSchema = z
  .object({
    utilization: ApiNullableNumberSchema.optional(),
    resets_at: z.string().nullish(),
  })
  .nullish();

const ReclaudeUsageSnapshotSchema = z
  .object({
    five_hour: ReclaudeUsageWindowSchema,
    seven_day: ReclaudeUsageWindowSchema,
    seven_day_opus: ReclaudeUsageWindowSchema,
    seven_day_omelette: ReclaudeUsageWindowSchema,
    seven_day_sonnet: ReclaudeUsageWindowSchema,
    extra_usage: z.object({ is_enabled: z.boolean().nullish() }).nullish(),
  })
  .nullish();

const ReclaudeAccountSchema = z.object({
  status: z.string().nullish(),
  email_masked: z.string().nullish(),
  subscription_type: z.string().nullish(),
  usage_updated_at: z.number().nullish(),
  usage_snapshot: ReclaudeUsageSnapshotSchema,
});

// GET /api/app/orgs/ — the org list carries the active org id and, per org, the
// currently bound Claude account (with its usage snapshot). We pick the active
// (or default) org and force-refresh its snapshot via the refresh endpoint.
const ReclaudeOrgsSchema = z.object({
  active_business_org_id: z.number().nullish(),
  default_org_id: z.number().nullish(),
  items: z
    .array(
      z.object({
        id: z.number(),
        current_account: ReclaudeAccountSchema.nullish(),
      }),
    )
    .default([]),
});

// POST /api/app/account/usage/refresh?org_id=… — forces reclaude.ai to re-pull
// the official usage and returns the fresh snapshot.
const ReclaudeRefreshSchema = z.object({
  usage_snapshot: ReclaudeUsageSnapshotSchema,
  usage_updated_at: z.number().nullish(),
});

type ReclaudeAccount = z.infer<typeof ReclaudeAccountSchema>;
type ReclaudeUsageSnapshot = z.infer<typeof ReclaudeUsageSnapshotSchema>;

const ReclaudeUsageMeSchema = z.object({
  status: z.string().nullish(),
  quota_limit_usd: z.coerce.number().nullish(),
  remaining_usd: z.coerce.number().nullish(),
  used_usd: z.coerce.number().nullish(),
});

export type ReclaudeLoginOutcome =
  | { step: "completed"; cookie: string }
  | { step: "mfa_required"; mfaChallengeToken: string };

export interface ReclaudeUsageIdentity {
  providerId: string;
  displayName: string;
}

export type ReclaudeUsageResult = ProviderUsage | "NEEDS_AUTH";

export interface ReclaudeClientOptions {
  fetch?: ProviderApiFetch;
  baseUrl?: string;
}

// Surfaces reclaude.ai's own error message (e.g. wrong password) so the client
// UI can show something actionable instead of a bare HTTP status.
export class ReclaudeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ReclaudeError";
  }
}

// True when a snapshot carries at least one usable usage window. Used to decide
// whether the (sometimes-empty) refresh response is worth adopting over the
// snapshot embedded in the orgs payload.
function snapshotHasWindowData(snapshot: ReclaudeUsageSnapshot): boolean {
  if (!snapshot) return false;
  return Boolean(
    snapshot.five_hour ||
    snapshot.seven_day ||
    snapshot.seven_day_opus ||
    snapshot.seven_day_omelette ||
    snapshot.seven_day_sonnet,
  );
}

function formatPlanLabel(subscriptionType: string | null | undefined): string | null {
  if (!subscriptionType) return null;
  return subscriptionType
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export class ReclaudeClient {
  private readonly fetchApi: ProviderApiFetch;
  private readonly baseUrl: string;

  constructor(options: ReclaudeClientOptions = {}) {
    this.fetchApi = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? RECLAUDE_BASE_URL;
  }

  async login(params: { email: string; password: string }): Promise<ReclaudeLoginOutcome> {
    const res = await this.post("/api/auth/login", {
      email: params.email,
      password: params.password,
    });
    if (!res.ok) {
      throw await this.toError(res);
    }
    const body = ReclaudeLoginResponseSchema.parse(await res.json().catch(() => ({})));
    if (body.step === "mfa_required") {
      if (!body.mfa_challenge_token) {
        throw new ReclaudeError(
          "Two-step verification required but no challenge was returned",
          200,
        );
      }
      return { step: "mfa_required", mfaChallengeToken: body.mfa_challenge_token };
    }
    const cookie = this.extractSessionCookie(res);
    if (!cookie) {
      throw new ReclaudeError("Sign-in succeeded but no session cookie was returned", 200);
    }
    return { step: "completed", cookie };
  }

  async verifyMfa(params: { challengeToken: string; code: string }): Promise<{ cookie: string }> {
    const res = await this.post("/api/auth/mfa/verify", {
      challenge_token: params.challengeToken,
      code: params.code,
    });
    if (!res.ok) {
      throw await this.toError(res);
    }
    const cookie = this.extractSessionCookie(res);
    if (!cookie) {
      throw new ReclaudeError("Verification did not return a session cookie", 200);
    }
    return { cookie };
  }

  async logout(cookie: string): Promise<void> {
    try {
      await this.post("/api/auth/logout", {}, cookie);
    } catch {
      // Best-effort; clearing the local cookie is what actually signs the user out.
    }
  }

  // Live usage fetch via the org-based refresh flow:
  //   1. GET /api/app/orgs/            → active/default org id + bound account
  //   2. POST .../usage/refresh?org_id → force a fresh official usage snapshot
  async fetchUsage(cookie: string, identity: ReclaudeUsageIdentity): Promise<ReclaudeUsageResult> {
    const resolved = await this.resolveOrgUsage(cookie);
    if (resolved === "NEEDS_AUTH") {
      return "NEEDS_AUTH";
    }
    return this.toProviderUsage({
      identity,
      account: resolved.account,
      snapshot: resolved.snapshot,
      updatedAtMs: resolved.updatedAtMs,
      balances: await this.fetchCreditBalance(cookie),
    });
  }

  private async resolveOrgUsage(cookie: string): Promise<
    | "NEEDS_AUTH"
    | {
        account: ReclaudeAccount | null;
        snapshot: ReclaudeUsageSnapshot;
        updatedAtMs: number | null;
      }
  > {
    const orgsRes = await this.get("/api/app/orgs/", cookie);
    if (orgsRes.status === 401 || orgsRes.status === 403) {
      return "NEEDS_AUTH";
    }
    if (!orgsRes.ok) {
      throw new ReclaudeError(`ReClaude orgs API returned ${orgsRes.status}`, orgsRes.status);
    }
    const orgs = ReclaudeOrgsSchema.parse(await orgsRes.json());
    const orgId = orgs.active_business_org_id ?? orgs.default_org_id ?? orgs.items[0]?.id ?? null;
    const orgItem = orgs.items.find((item) => item.id === orgId) ?? orgs.items[0];
    const account = orgItem?.current_account ?? null;

    // The orgs payload already carries a usable snapshot; the refresh POST asks
    // reclaude.ai to re-pull from Anthropic. The refresh response sometimes comes
    // back empty (a background re-pull that hasn't landed yet), so we only adopt
    // it when it actually contains window data — otherwise we keep the orgs one.
    const fallback = {
      account,
      snapshot: account?.usage_snapshot ?? null,
      updatedAtMs: account?.usage_updated_at ?? null,
    };
    if (orgId == null) {
      return fallback;
    }
    const refreshed = await this.refreshOrgSnapshot(cookie, orgId);
    if (refreshed === "NEEDS_AUTH") {
      return "NEEDS_AUTH";
    }
    if (!refreshed) {
      return fallback;
    }
    return {
      account,
      snapshot: refreshed.snapshot,
      updatedAtMs: refreshed.updatedAtMs ?? fallback.updatedAtMs,
    };
  }

  // POST the refresh endpoint and return the fresh snapshot only when it carries
  // window data; null means "use the fallback (orgs) snapshot instead".
  private async refreshOrgSnapshot(
    cookie: string,
    orgId: number,
  ): Promise<
    "NEEDS_AUTH" | { snapshot: ReclaudeUsageSnapshot; updatedAtMs: number | null } | null
  > {
    const res = await this.post(`/api/app/account/usage/refresh?org_id=${orgId}`, {}, cookie);
    if (res.status === 401 || res.status === 403) {
      return "NEEDS_AUTH";
    }
    if (!res.ok) {
      return null;
    }
    const refreshed = ReclaudeRefreshSchema.parse(await res.json());
    if (!snapshotHasWindowData(refreshed.usage_snapshot)) {
      return null;
    }
    return { snapshot: refreshed.usage_snapshot, updatedAtMs: refreshed.usage_updated_at ?? null };
  }

  private buildUsageWindows(snapshot: ReclaudeUsageSnapshot): ProviderUsageWindow[] {
    const windows: ProviderUsageWindow[] = [];
    const pushWindow = (
      window: z.infer<typeof ReclaudeUsageWindowSchema>,
      id: string,
      label: string,
    ) => {
      if (!window) return;
      windows.push({
        // reclaude windows render a full live countdown (days/hours/minutes/seconds),
        // never the abbreviated single-unit / "resetting now" label.
        ...windowFromUsedPct({
          id,
          label,
          utilizationPct: window.utilization ?? null,
          resetsAt: window.resets_at ?? null,
          tone: "ok",
        }),
        fullCountdown: true,
      });
    };
    pushWindow(snapshot?.five_hour, "five_hour", "Session");
    pushWindow(snapshot?.seven_day, "weekly", "Weekly");
    pushWindow(snapshot?.seven_day_opus, "weekly_opus", "Weekly · Opus");
    pushWindow(snapshot?.seven_day_omelette, "weekly_omelette", "Weekly · Omelette");
    pushWindow(snapshot?.seven_day_sonnet, "weekly_sonnet", "Weekly · Sonnet");
    return windows;
  }

  private toProviderUsage(input: {
    identity: ReclaudeUsageIdentity;
    account: ReclaudeAccount | null;
    snapshot: ReclaudeUsageSnapshot;
    updatedAtMs: number | null;
    balances: ProviderUsageBalance[];
  }): ProviderUsage {
    const details: ProviderUsageDetail[] = [];
    if (input.account?.email_masked) {
      details.push({ id: "reclaude_account", label: "Account", value: input.account.email_masked });
    }
    return {
      providerId: input.identity.providerId,
      displayName: input.identity.displayName,
      status: "available",
      planLabel: formatPlanLabel(input.account?.subscription_type),
      sourceLabel: "ReClaude",
      fetchedAt: input.updatedAtMs
        ? new Date(input.updatedAtMs).toISOString()
        : new Date().toISOString(),
      windows: this.buildUsageWindows(input.snapshot),
      balances: input.balances,
      details,
      error: null,
    };
  }

  // The USD credit ledger lives on a separate endpoint. Subscription users have
  // none (status "none", zeroes) — only show a balance when there's a real cap.
  private async fetchCreditBalance(cookie: string): Promise<ProviderUsageBalance[]> {
    try {
      const res = await this.get("/api/app/usage/me", cookie);
      if (!res.ok) return [];
      const usage = ReclaudeUsageMeSchema.parse(await res.json());
      const limit = usage.quota_limit_usd ?? null;
      if (usage.status === "none" || !limit || limit <= 0) {
        return [];
      }
      const remaining = usage.remaining_usd ?? null;
      return [
        {
          id: "reclaude_credit",
          label: "Credit",
          used: usage.used_usd ?? null,
          remaining,
          limit,
          unit: "usd",
          tone: balanceToneFromRemaining(remaining),
        },
      ];
    } catch {
      return [];
    }
  }

  private get(path: string, cookie: string): Promise<Response> {
    return fetchProviderApi(this.fetchApi, `${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": RECLAUDE_USER_AGENT,
        "x-lang": "en",
        Cookie: cookie,
      },
    });
  }

  private post(path: string, body: unknown, cookie?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": RECLAUDE_USER_AGENT,
      "x-lang": "en",
    };
    if (cookie) {
      headers.Cookie = cookie;
    }
    return fetchProviderApi(this.fetchApi, `${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  // Pull the rc_sid session cookie out of the response's Set-Cookie header(s)
  // and return it as a ready-to-send `name=value` Cookie header string.
  private extractSessionCookie(res: Response): string | null {
    // getSetCookie() is the undici/Node way to read multiple Set-Cookie headers;
    // fall back to the single-header getter. Cast because the DOM Headers type
    // may not declare getSetCookie depending on the TS lib version.
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
    for (const entry of setCookies) {
      const pair = entry.split(";", 1)[0]?.trim();
      if (pair && pair.startsWith(`${RECLAUDE_SESSION_COOKIE}=`)) {
        return pair;
      }
    }
    return null;
  }

  private async toError(res: Response): Promise<ReclaudeError> {
    const body = await res.json().catch(() => null);
    const parsed = ReclaudeErrorBodySchema.safeParse(body);
    const message = parsed.success && parsed.data.message ? parsed.data.message : null;
    const code = parsed.success ? parsed.data.code : undefined;
    return new ReclaudeError(
      message ?? `ReClaude request failed (${res.status})`,
      res.status,
      code,
    );
  }
}
