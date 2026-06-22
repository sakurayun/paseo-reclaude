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
      "/api/app/me": () =>
        jsonResponse({
          email: "a@b.com",
          subscription: { status: "active" },
          current_account: {
            status: "bound",
            email_masked: "a***@b.com",
            subscription_type: "max_20x",
            usage_updated_at: 1781956725333,
            usage_snapshot: {
              five_hour: { utilization: 25, resets_at: "2026-06-22T10:00:00Z" },
              seven_day: { utilization: 60, resets_at: null },
              seven_day_opus: { utilization: 80, resets_at: null },
              seven_day_omelette: null,
            },
          },
        }),
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
    expect(usage.windows.map((w) => w.id)).toEqual(["five_hour", "weekly", "weekly_opus"]);
    const session = usage.windows[0];
    expect(session.usedPct).toBe(25);
    expect(session.remainingPct).toBe(75);
    expect(session.resetsAt).toBe("2026-06-22T10:00:00Z");
    // Subscription users have no USD credit ledger, so no balances.
    expect(usage.balances).toEqual([]);
  });

  it("exposes a USD credit balance when the account has a real cap", async () => {
    const { fn } = fakeFetch({
      "/api/app/me": () =>
        jsonResponse({
          email: "a@b.com",
          current_account: { subscription_type: "credits", usage_snapshot: { five_hour: null } },
        }),
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
      "/api/app/me": () => jsonResponse({ message: "unauthorized" }, { status: 401 }),
    });
    const client = new ReclaudeClient({ fetch: fn });

    expect(await client.fetchUsage("rc_sid=stale", IDENTITY)).toBe("NEEDS_AUTH");
  });
});
