import { formatTokenCount } from "@/components/context-window-meter.utils";
import type { TFunction } from "i18next";
import type { ProviderUsageBalanceUnit } from "./types";

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number): string {
  return `${Math.round(clampPct(value))}%`;
}

type RelativeDuration =
  | { unit: "now"; value: 0 }
  | { unit: "minutes" | "hours" | "days"; value: number };

function relativeDuration(iso: string): RelativeDuration | null {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return { unit: "now", value: 0 };
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return { unit: "days", value: diffDays };
  if (diffHours > 0) return { unit: "hours", value: diffHours };
  return { unit: "minutes", value: diffMinutes };
}

export function formatResetLabel(iso: string | null | undefined, t: TFunction): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso);
  if (!rel) return null;
  switch (rel.unit) {
    case "now":
      return t("providerUsage.reset.resettingNow");
    case "days":
      return t("providerUsage.reset.resetsDays", { value: rel.value });
    case "hours":
      return t("providerUsage.reset.resetsHours", { value: rel.value });
    default:
      return t("providerUsage.reset.resetsMinutes", { value: rel.value });
  }
}

export function formatRunsOutLabel(iso: string | null | undefined, t: TFunction): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso);
  if (!rel) return null;
  switch (rel.unit) {
    case "now":
      return t("providerUsage.risk.runsOutNow");
    case "days":
      return t("providerUsage.risk.runsOutDays", { value: rel.value });
    case "hours":
      return t("providerUsage.risk.runsOutHours", { value: rel.value });
    default:
      return t("providerUsage.risk.runsOutMinutes", { value: rel.value });
  }
}

export function formatAgo(iso: string | null | undefined, t: TFunction): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 60_000) return t("time.justNow");
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return t("time.relative.daysAgo", { value: diffDays });
  if (diffHours > 0) return t("time.relative.hoursAgo", { value: diffHours });
  return t("time.relative.minutesAgo", { value: diffMinutes });
}

export function formatAmount(value: number, unit: ProviderUsageBalanceUnit): string {
  switch (unit) {
    case "usd":
      return `$${value.toFixed(2)}`;
    case "tokens":
      return formatTokenCount(value);
    default:
      return value.toLocaleString();
  }
}
