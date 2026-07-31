import { describe, expect, it } from "vitest";
import {
  matchProviderUsage,
  resolveMeterDisplayPercentage,
  resolvePrimaryUsage,
} from "./primary-usage";
import type { ProviderUsage } from "./types";

function baseUsage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    providerId: "grok",
    displayName: "Grok Build",
    status: "available",
    planLabel: null,
    windows: [],
    ...overrides,
  };
}

describe("resolvePrimaryUsage", () => {
  it("prefers the first window with usedPct", () => {
    const result = resolvePrimaryUsage(
      baseUsage({
        windows: [
          { id: "weekly", label: "Weekly", usedPct: 64, tone: "ok" },
          { id: "monthly", label: "Monthly", usedPct: 12, tone: "ok" },
        ],
      }),
    );
    expect(result).toEqual({
      usedPct: 64,
      remainingPct: 36,
      tone: "ok",
      label: "Weekly",
    });
  });

  it("derives usedPct from remainingPct when usedPct is absent", () => {
    const result = resolvePrimaryUsage(
      baseUsage({
        windows: [{ id: "session", label: "Session", remainingPct: 40 }],
      }),
    );
    expect(result?.usedPct).toBe(60);
    expect(result?.remainingPct).toBe(40);
    expect(result?.tone).toBe("default");
  });

  it("falls back to balances with a limit", () => {
    const result = resolvePrimaryUsage(
      baseUsage({
        windows: [],
        balances: [
          {
            id: "monthlyCredits",
            label: "Monthly credits",
            used: 25,
            limit: 100,
            remaining: 75,
            unit: "credits",
            tone: "warning",
          },
        ],
      }),
    );
    expect(result).toEqual({
      usedPct: 25,
      remainingPct: 75,
      tone: "warning",
      label: "Monthly credits",
    });
  });

  it("returns null when nothing is measurable", () => {
    expect(resolvePrimaryUsage(baseUsage({ windows: [], balances: [] }))).toBeNull();
  });
});

describe("resolveMeterDisplayPercentage", () => {
  const snapshot = {
    usedPct: 64,
    remainingPct: 36,
    tone: "ok" as const,
    label: "Weekly",
  };

  it("returns used pct in used mode", () => {
    expect(resolveMeterDisplayPercentage(snapshot, "used")).toBe(64);
  });

  it("returns remaining pct in remaining mode", () => {
    expect(resolveMeterDisplayPercentage(snapshot, "remaining")).toBe(36);
  });
});

describe("matchProviderUsage", () => {
  it("matches provider id case-insensitively", () => {
    const providers = [baseUsage({ providerId: "Grok" })];
    expect(matchProviderUsage(providers, "grok")?.providerId).toBe("Grok");
    expect(matchProviderUsage(providers, "claude")).toBeNull();
  });
});
