import type { ProviderUsage, ProviderUsageTone, ProviderUsageWindow } from "./types";
import { deriveTone } from "./tone";

export type MeterPercentageMode = "used" | "remaining";

export interface PrimaryUsageSnapshot {
  usedPct: number;
  remainingPct: number;
  tone: ProviderUsageTone;
  label: string | null;
}

function resolveWindowUsedPct(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Pick the single highest-signal utilization for the compact meter ring.
 * Prefer the first window with a percentage; fall back to balances with a limit.
 */
export function resolvePrimaryUsage(usage: ProviderUsage): PrimaryUsageSnapshot | null {
  for (const window of usage.windows) {
    const usedPct = resolveWindowUsedPct(window);
    if (usedPct == null || !Number.isFinite(usedPct)) continue;
    const clampedUsed = clampPct(usedPct);
    return {
      usedPct: clampedUsed,
      remainingPct: clampPct(100 - clampedUsed),
      tone: window.tone ?? deriveTone(clampedUsed),
      label: window.label || null,
    };
  }

  for (const balance of usage.balances ?? []) {
    if (balance.limit == null || !(balance.limit > 0)) continue;
    const used =
      balance.used ?? (balance.remaining != null ? balance.limit - balance.remaining : null);
    if (used == null || !Number.isFinite(used)) continue;
    const usedPct = clampPct((used / balance.limit) * 100);
    return {
      usedPct,
      remainingPct: clampPct(100 - usedPct),
      tone: balance.tone ?? deriveTone(usedPct),
      label: balance.label || null,
    };
  }

  return null;
}

/** Arc fill + center label percentage for the selected display mode. */
export function resolveMeterDisplayPercentage(
  snapshot: PrimaryUsageSnapshot,
  mode: MeterPercentageMode,
): number {
  return mode === "remaining" ? snapshot.remainingPct : snapshot.usedPct;
}

export function matchProviderUsage(
  providers: ProviderUsage[],
  activeProviderId: string | null | undefined,
): ProviderUsage | null {
  if (!activeProviderId) return null;
  const target = activeProviderId.toLowerCase();
  return providers.find((usage) => usage.providerId.toLowerCase() === target) ?? null;
}
