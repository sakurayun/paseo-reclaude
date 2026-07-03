import { describe, expect, it } from "vitest";

import { ReclaudeClient, ReclaudeError } from "./reclaude-client.js";

const IDENTITY = { providerId: "claude", displayName: "Claude" };

function jsonResponse(body: unknown, init: { status?: number; setCookie?: string } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.setCookie) {
    headers.append("set-cookie", init.setCookie);
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

// A fetch double that dispatches by URL path and records the requests it saw.
function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) throw new Error(`Unexpected request: ${path}`);
    return handler(init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// Wraps a usage snapshot in the /api/app/orgs/ envelope the live usage flow reads
// (active org id + the bound account that carries the snapshot).
function orgsResponse(
  usageSnapshot: unknown,
  opts: { subscriptionType?: string; emailMasked?: string; status?: number } = {},
): Response {
  return jsonResponse(
    {
      active_business_org_id: 256,
      default_org_id: 256,
      items: [
        {
          id: 256,
          current_account: {
            status: "bound",
            email_masked: opts.emailMasked ?? "a***@b.com",
            subscription_type: opts.subscriptionType ?? "max_20x",
            usage_updated_at: 1781956725333,
            usage_snapshot: usageSnapshot,
          },
        },
      ],
      show_picker: false,
    },
    { status: opts.status },
  );
}

// The refresh POST often comes back empty; returning an empty snapshot makes the
// client fall back to the (populated) snapshot embedded in the orgs payload.
const emptyRefreshResponse = () => jsonResponse({ usage_snapshot: { five_hour: null } });

describe("ReclaudeClient.login", () => {
  it("captures the rc_sid session cookie on a completed login", async () => {
    const { fn, calls } = fakeFetch({
      "/api/auth/login": () =>
        jsonResponse(
          { step: "completed", landing_route: "/app" },
          { setCookie: "rc_sid=session-abc; Path=/; HttpOnly; Secure; SameSite=Lax" },
        ),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const result = await client.login({ email: "a@b.com", password: "pw" });

    expect(result).toEqual({ step: "completed", cookie: "rc_sid=session-abc" });
    // Credentials must be POSTed in the body.
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      email: "a@b.com",
      password: "pw",
    });
  });

  it("returns the MFA challenge when two-step verification is required", async () => {
    const { fn } = fakeFetch({
      "/api/auth/login": () =>
        jsonResponse({ step: "mfa_required", mfa_challenge_token: "chal-123" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const result = await client.login({ email: "a@b.com", password: "pw" });

    expect(result).toEqual({ step: "mfa_required", mfaChallengeToken: "chal-123" });
  });

  it("surfaces reclaude's error message on a failed login", async () => {
    const { fn } = fakeFetch({
      "/api/auth/login": () =>
        jsonResponse({ code: "bad_credentials", message: "Wrong password" }, { status: 401 }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    await expect(client.login({ email: "a@b.com", password: "bad" })).rejects.toMatchObject({
      message: "Wrong password",
    });
    await expect(client.login({ email: "a@b.com", password: "bad" })).rejects.toBeInstanceOf(
      ReclaudeError,
    );
  });
});

describe("ReclaudeClient.verifyMfa", () => {
  it("captures the cookie after a successful MFA verification", async () => {
    const { fn } = fakeFetch({
      "/api/auth/mfa/verify": () =>
        jsonResponse({ step: "completed" }, { setCookie: "rc_sid=after-mfa; Path=/" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const result = await client.verifyMfa({ challengeToken: "chal-123", code: "000000" });

    expect(result).toEqual({ cookie: "rc_sid=after-mfa" });
  });
});

describe("ReclaudeClient.fetchUsage", () => {
  it("maps the passed-through OAuth usage snapshot into provider windows", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          five_hour: { utilization: 25, resets_at: "2026-06-22T10:00:00Z" },
          seven_day: { utilization: 60, resets_at: null },
          seven_day_opus: { utilization: 80, resets_at: null },
          seven_day_omelette: null,
          limits: [
            {
              group: "weekly",
              is_active: false,
              kind: "weekly_scoped",
              percent: 0,
              resets_at: null,
              scope: { model: { display_name: "Fable", id: null }, surface: null },
              severity: "normal",
            },
          ],
        }),
      "/api/app/account/usage/refresh": emptyRefreshResponse,
      "/api/app/usage/me": () =>
        jsonResponse({ status: "none", quota_limit_usd: "0", remaining_usd: "0", used_usd: "0" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);

    expect(usage).not.toBe("NEEDS_AUTH");
    if (usage === "NEEDS_AUTH") return;
    expect(usage.providerId).toBe("claude");
    expect(usage.sourceLabel).toBe("ReClaude");
    expect(usage.planLabel).toBe("Max 20x");
    expect(usage.status).toBe("available");
    // The Fable scoped weekly limit (from limits[]) renders as its own window.
    expect(usage.windows.map((w) => w.id)).toEqual([
      "five_hour",
      "weekly",
      "weekly_opus",
      "weekly_fable",
    ]);
    const session = usage.windows[0];
    expect(session.usedPct).toBe(25);
    expect(session.remainingPct).toBe(75);
    expect(session.resetsAt).toBe("2026-06-22T10:00:00Z");
    // The real Fable payload is percent:0 / resets_at:null — assert it renders as
    // 0% (not dropped, not null) with no reset countdown.
    const fable = usage.windows.find((w) => w.id === "weekly_fable");
    expect(fable?.label).toBe("Weekly · Fable");
    expect(fable?.usedPct).toBe(0);
    expect(fable?.remainingPct).toBe(100);
    expect(fable?.resetsAt).toBeNull();
    expect(fable?.fullCountdown).toBe(true);
    // Subscription users have no USD credit ledger, so no balances.
    expect(usage.balances).toEqual([]);
  });

  it("surfaces the Fable scoped weekly limit as its own window", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          five_hour: { utilization: 6, resets_at: "2026-07-02T16:19:59.513142+00:00" },
          seven_day: { utilization: 11, resets_at: "2026-07-07T06:59:59.513162+00:00" },
          limits: [
            {
              kind: "weekly_all",
              percent: 11,
              resets_at: "2026-07-07T06:59:59.513162+00:00",
              scope: null,
            },
            {
              kind: "weekly_scoped",
              percent: 34,
              resets_at: "2026-07-07T06:59:59.513162+00:00",
              scope: { model: { display_name: "Fable", id: null } },
            },
          ],
        }),
      "/api/app/account/usage/refresh": emptyRefreshResponse,
      "/api/app/usage/me": () => jsonResponse({ status: "none" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    const fable = usage.windows.find((w) => w.id === "weekly_fable");
    expect(fable).toBeDefined();
    expect(fable?.label).toBe("Weekly · Fable");
    expect(fable?.usedPct).toBe(34);
    expect(fable?.remainingPct).toBe(66);
    expect(fable?.resetsAt).toBe("2026-07-07T06:59:59.513162+00:00");
    // reclaude windows render a full live countdown, not the abbreviated label.
    expect(fable?.fullCountdown).toBe(true);
    // weekly_all is already covered by the top-level `weekly` window; only the
    // scoped model should add a new window.
    expect(usage.windows.map((w) => w.id)).toEqual(["five_hour", "weekly", "weekly_fable"]);
  });

  it("does not double-count a scoped model already shown as a top-level window", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          seven_day_opus: { utilization: 80, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 50,
              resets_at: null,
              scope: { model: { display_name: "Opus", id: null } },
            },
          ],
        }),
      "/api/app/account/usage/refresh": emptyRefreshResponse,
      "/api/app/usage/me": () => jsonResponse({ status: "none" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    // Only one weekly_opus window, and it keeps the top-level utilization (80), not
    // the scoped duplicate (50).
    const opus = usage.windows.filter((w) => w.id === "weekly_opus");
    expect(opus).toHaveLength(1);
    expect(opus[0].usedPct).toBe(80);
  });

  it("adopts the refreshed windows but keeps the Fable limit when refresh omits limits[]", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          five_hour: { utilization: 6, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 34,
              resets_at: "2026-07-07T06:59:59Z",
              scope: { model: { display_name: "Fable", id: null } },
            },
          ],
        }),
      // A force re-pull that returned fresh top-level windows but no limits[].
      "/api/app/account/usage/refresh": () =>
        jsonResponse({
          usage_snapshot: {
            five_hour: { utilization: 20, resets_at: null },
            seven_day: { utilization: 40, resets_at: null },
          },
          usage_updated_at: 1782000000000,
        }),
      "/api/app/usage/me": () => jsonResponse({ status: "none" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    // Fresher five_hour utilization came from the adopted refresh snapshot...
    expect(usage.windows.find((w) => w.id === "five_hour")?.usedPct).toBe(20);
    // ...and the Fable window survived by backfilling limits[] from the orgs snapshot.
    expect(usage.windows.find((w) => w.id === "weekly_fable")?.usedPct).toBe(34);
  });

  it("prefers the refresh snapshot's own scoped limits over the orgs fallback", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          five_hour: { utilization: 6, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              percent: 34,
              resets_at: null,
              scope: { model: { display_name: "Fable", id: null } },
            },
          ],
        }),
      "/api/app/account/usage/refresh": () =>
        jsonResponse({
          usage_snapshot: {
            five_hour: { utilization: 20, resets_at: null },
            limits: [
              {
                kind: "weekly_scoped",
                percent: 77,
                resets_at: null,
                scope: { model: { display_name: "Fable", id: null } },
              },
            ],
          },
        }),
      "/api/app/usage/me": () => jsonResponse({ status: "none" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    // The refresh carried its own Fable limit (77); the orgs fallback (34) is not used.
    expect(usage.windows.find((w) => w.id === "weekly_fable")?.usedPct).toBe(77);
  });

  it("skips a null element in limits[] without failing the whole parse", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () =>
        orgsResponse({
          five_hour: { utilization: 6, resets_at: null },
          limits: [
            null,
            {
              kind: "weekly_scoped",
              percent: 34,
              resets_at: null,
              scope: { model: { display_name: "Fable", id: null } },
            },
          ],
        }),
      "/api/app/account/usage/refresh": emptyRefreshResponse,
      "/api/app/usage/me": () => jsonResponse({ status: "none" }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    // The stray null is skipped; the card is not blanked and Fable still renders.
    expect(usage.status).toBe("available");
    expect(usage.windows.find((w) => w.id === "weekly_fable")?.usedPct).toBe(34);
  });

  it("exposes a USD credit balance when the account has a real cap", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () => orgsResponse({ five_hour: null }, { subscriptionType: "credits" }),
      "/api/app/account/usage/refresh": emptyRefreshResponse,
      "/api/app/usage/me": () =>
        jsonResponse({
          status: "active",
          quota_limit_usd: "100",
          remaining_usd: "40",
          used_usd: "60",
        }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    const usage = await client.fetchUsage("rc_sid=abc", IDENTITY);
    if (usage === "NEEDS_AUTH") throw new Error("unexpected NEEDS_AUTH");

    expect(usage.balances).toEqual([
      expect.objectContaining({ id: "reclaude_credit", remaining: 40, limit: 100, unit: "usd" }),
    ]);
  });

  it("returns NEEDS_AUTH when the session cookie is rejected", async () => {
    const { fn } = fakeFetch({
      "/api/app/orgs/": () => jsonResponse({ message: "unauthorized" }, { status: 401 }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    expect(await client.fetchUsage("rc_sid=stale", IDENTITY)).toBe("NEEDS_AUTH");
  });
});
