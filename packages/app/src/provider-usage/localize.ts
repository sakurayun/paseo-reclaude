import type { TFunction } from "i18next";

import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageWindow,
} from "./types";

/**
 * Server quota providers emit English labels (protocol stays language-neutral).
 * Map well-known ids / display names into the active locale for the Host usage UI.
 * Unknown ids fall back to the server-provided string.
 */

const PROVIDER_DISPLAY_NAME_KEYS: Record<string, string> = {
  claude: "providerUsage.providers.claude",
  codex: "providerUsage.providers.codex",
  copilot: "providerUsage.providers.copilot",
  cursor: "providerUsage.providers.cursor",
  zai: "providerUsage.providers.zai",
  grok: "providerUsage.providers.grok",
  kimi: "providerUsage.providers.kimi",
  minimax: "providerUsage.providers.minimax",
};

const WINDOW_LABEL_KEYS: Record<string, string> = {
  five_hour: "providerUsage.windows.fiveHour",
  session: "providerUsage.windows.session",
  weekly: "providerUsage.windows.weekly",
  weekly_opus: "providerUsage.windows.weeklyOpus",
  weekly_omelette: "providerUsage.windows.weeklyOmelette",
  weekly_sonnet: "providerUsage.windows.weeklySonnet",
  weekly_design: "providerUsage.windows.weeklyDesign",
  code_review: "providerUsage.windows.codeReview",
  monthly: "providerUsage.windows.monthly",
  coding_usage: "providerUsage.windows.codingUsage",
};

const BALANCE_LABEL_KEYS: Record<string, string> = {
  monthly_credits: "providerUsage.balances.monthlyCredits",
  on_demand_cap: "providerUsage.balances.onDemandCap",
  plan_usage: "providerUsage.balances.planUsage",
  credits: "providerUsage.balances.credits",
  credit: "providerUsage.balances.credits",
};

const DETAIL_LABEL_KEYS: Record<string, string> = {
  period_start: "providerUsage.details.periodStart",
  period_end: "providerUsage.details.periodEnd",
  previous_cycle: "providerUsage.details.previousCycle",
  status: "providerUsage.details.status",
  valid: "providerUsage.details.valid",
  purchase_time: "providerUsage.details.purchased",
  extra_usage: "providerUsage.details.extraUsage",
  reset: "providerUsage.details.quotaReset",
  reclaude_account: "providerUsage.details.account",
  account: "providerUsage.details.account",
};

const DETAIL_VALUE_KEYS: Record<string, string> = {
  Enabled: "providerUsage.detailValues.enabled",
  Disabled: "providerUsage.detailValues.disabled",
  VALID: "providerUsage.detailValues.valid",
  INVALID: "providerUsage.detailValues.invalid",
  EXPIRED: "providerUsage.detailValues.expired",
};

function translateKey(t: TFunction, key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  const translated = t(key, { defaultValue: "" });
  return translated || fallback;
}

function localizeWindowLabel(t: TFunction, window: ProviderUsageWindow): string {
  const byId = WINDOW_LABEL_KEYS[window.id];
  if (byId) {
    return translateKey(t, byId, window.label);
  }
  // Scoped weekly model windows: "Weekly · Fable" → "每周 · Fable"
  const weeklyScoped = window.id.startsWith("weekly_") || window.label.startsWith("Weekly · ");
  if (weeklyScoped) {
    const modelName =
      window.label.replace(/^Weekly\s*·\s*/i, "").trim() ||
      window.id.replace(/^weekly_/, "").replace(/_/g, " ");
    return t("providerUsage.windows.weeklyModel", {
      model: modelName,
      defaultValue: window.label,
    });
  }
  // MiniMax style: "ModelName · Interval" / "ModelName · Weekly"
  if (window.label.endsWith(" · Interval")) {
    const model = window.label.slice(0, -" · Interval".length);
    return t("providerUsage.windows.modelInterval", { model, defaultValue: window.label });
  }
  if (window.label.endsWith(" · Weekly")) {
    const model = window.label.slice(0, -" · Weekly".length);
    return t("providerUsage.windows.modelWeekly", { model, defaultValue: window.label });
  }
  return window.label;
}

function localizeBalanceLabel(t: TFunction, balance: ProviderUsageBalance): string {
  return translateKey(t, BALANCE_LABEL_KEYS[balance.id], balance.label);
}

function formatIsoDateTime(value: string, locale: string): string | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

function localizeDetailValue(t: TFunction, detail: ProviderUsageDetail, locale: string): string {
  const known = DETAIL_VALUE_KEYS[detail.value];
  if (known) {
    return translateKey(t, known, detail.value);
  }
  // ISO timestamps from Grok / Z.AI → locale-friendly date string
  if (/^\d{4}-\d{2}-\d{2}T/.test(detail.value)) {
    return formatIsoDateTime(detail.value, locale) ?? detail.value;
  }
  // Grok previous cycle: "2026-06 · 0 credits"
  const previousCycle = detail.value.match(/^(\d{4}-\d{2})\s*·\s*(\d+)\s*credits?$/i);
  if (previousCycle) {
    return t("providerUsage.detailValues.previousCycleCredits", {
      period: previousCycle[1],
      credits: previousCycle[2],
      defaultValue: detail.value,
    });
  }
  return detail.value;
}

function localizeDetail(
  t: TFunction,
  detail: ProviderUsageDetail,
  locale: string,
): ProviderUsageDetail {
  return {
    ...detail,
    label: translateKey(t, DETAIL_LABEL_KEYS[detail.id], detail.label),
    value: localizeDetailValue(t, detail, locale),
  };
}

const ERROR_HINTS: Array<{ match: RegExp; key: string }> = [
  {
    match: /grok login|XAI_API_KEY/i,
    key: "providerUsage.errors.grokSignIn",
  },
  {
    match: /session expired|grok session expired/i,
    key: "providerUsage.errors.grokSessionExpired",
  },
  {
    match: /billing API returned HTTP/i,
    key: "providerUsage.errors.billingHttp",
  },
  {
    match: /could not be parsed/i,
    key: "providerUsage.errors.parseFailed",
  },
  {
    match: /chatgpt authentication required|authentication required to read rate limits/i,
    key: "providerUsage.errors.codexChatgptAuthRequired",
  },
];

function localizeError(t: TFunction, error: string | null | undefined): string | null {
  if (!error) return null;
  for (const hint of ERROR_HINTS) {
    if (hint.match.test(error)) {
      return translateKey(t, hint.key, error);
    }
  }
  return error;
}

export function localizeProviderUsage(
  usage: ProviderUsage,
  t: TFunction,
  locale: string = "zh-CN",
): ProviderUsage {
  const displayNameKey = PROVIDER_DISPLAY_NAME_KEYS[usage.providerId];
  return {
    ...usage,
    displayName: translateKey(t, displayNameKey, usage.displayName),
    planLabel: usage.planLabel
      ? translateKey(
          t,
          usage.planLabel === "Grok Build" ? "providerUsage.providers.grok" : undefined,
          usage.planLabel,
        )
      : usage.planLabel,
    sourceLabel: usage.sourceLabel
      ? translateKey(
          t,
          usage.sourceLabel === "ReClaude" ? "providerUsage.sources.reclaude" : undefined,
          usage.sourceLabel,
        )
      : usage.sourceLabel,
    error: localizeError(t, usage.error),
    windows: usage.windows.map((window) =>
      Object.assign({}, window, { label: localizeWindowLabel(t, window) }),
    ),
    balances: (usage.balances ?? []).map((balance) =>
      Object.assign({}, balance, { label: localizeBalanceLabel(t, balance) }),
    ),
    details: (usage.details ?? []).map((detail) => localizeDetail(t, detail, locale)),
  };
}
