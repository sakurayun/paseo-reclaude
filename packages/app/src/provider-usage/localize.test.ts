import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { localizeProviderUsage } from "./localize";
import type { ProviderUsage } from "./types";

function makeT(map: Record<string, string>): TFunction {
  return ((key: string, options?: Record<string, unknown>) => {
    const template =
      map[key] ?? (typeof options?.defaultValue === "string" ? options.defaultValue : "");
    if (!template) return "";
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
  }) as TFunction;
}

const zhMap: Record<string, string> = {
  "providerUsage.providers.grok": "Grok Build",
  "providerUsage.plans.superGrok": "SuperGrok",
  "providerUsage.balances.monthlyCredits": "每月额度",
  "providerUsage.balances.onDemandCap": "按需上限",
  "providerUsage.balances.prepaidCredits": "预付额度",
  "providerUsage.windows.monthly": "每月",
  "providerUsage.windows.weekly": "每周",
  "providerUsage.details.periodStart": "账期开始",
  "providerUsage.details.periodEnd": "账期结束",
  "providerUsage.details.weekStarts": "本周开始",
  "providerUsage.details.weekResets": "本周重置",
  "providerUsage.details.previousCycle": "上一周期",
  "providerUsage.details.plan": "套餐",
  "providerUsage.details.currentPeriod": "当前周期",
  "providerUsage.detailValues.previousCycleCredits": "{{period}} · {{credits}} 额度",
  "providerUsage.detailValues.weekly": "每周",
  "providerUsage.errors.grokSignIn":
    "请先运行 `grok login` 登录，或设置 XAI_API_KEY 以查看 Grok Build 用量。",
};
describe("localizeProviderUsage", () => {
  it("localizes Grok Build labels into Chinese", () => {
    const usage: ProviderUsage = {
      providerId: "grok",
      displayName: "Grok Build",
      planLabel: "SuperGrok",
      status: "available",
      fetchedAt: "2026-07-13T00:00:00.000Z",
      error: null,
      windows: [
        { id: "weekly", label: "Weekly", usedPct: 64, tone: "ok", fullCountdown: true },
        { id: "monthly", label: "Monthly", usedPct: 12, tone: "ok" },
      ],
      balances: [
        {
          id: "monthly_credits",
          label: "Monthly credits",
          used: 10,
          remaining: 90,
          limit: 100,
          unit: "credits",
          tone: "ok",
        },
        {
          id: "on_demand_cap",
          label: "On-demand cap",
          used: null,
          remaining: 50,
          limit: 50,
          unit: "credits",
          tone: "default",
        },
      ],
      details: [
        {
          id: "subscription",
          label: "Plan",
          value: "SuperGrok",
        },
        {
          id: "current_period",
          label: "Current period",
          value: "Weekly",
        },
        {
          id: "period_start",
          label: "Week starts",
          value: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "previous_cycle",
          label: "Previous cycle",
          value: "2026-06 · 0 credits",
        },
      ],
    };

    const localized = localizeProviderUsage(usage, makeT(zhMap), "zh-CN");
    expect(localized.planLabel).toBe("SuperGrok");
    expect(localized.balances?.map((b) => b.label)).toEqual(["每月额度", "按需上限"]);
    expect(localized.windows.map((w) => w.label)).toEqual(["每周", "每月"]);
    expect(localized.details?.[0]?.label).toBe("套餐");
    expect(localized.details?.[1]?.label).toBe("当前周期");
    expect(localized.details?.[1]?.value).toBe("每周");
    expect(localized.details?.[2]?.label).toBe("本周开始");
    expect(localized.details?.[3]?.label).toBe("上一周期");
    expect(localized.details?.[3]?.value).toBe("2026-06 · 0 额度");
  });
  it("localizes well-known Grok sign-in errors", () => {
    const usage: ProviderUsage = {
      providerId: "grok",
      displayName: "Grok Build",
      planLabel: null,
      status: "unavailable",
      fetchedAt: null,
      error: "Sign in with `grok login` or set XAI_API_KEY to view Grok Build usage.",
      windows: [],
      balances: [],
      details: [],
    };
    const localized = localizeProviderUsage(usage, makeT(zhMap), "zh-CN");
    expect(localized.error).toContain("grok login");
    expect(localized.error).toContain("XAI_API_KEY");
    expect(localized.error).not.toMatch(/^Sign in/);
  });
});
