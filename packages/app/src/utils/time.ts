import { i18n } from "@/i18n/i18next";
import { getActiveLocale } from "@/i18n/use-locale";

/**
 * Format a date as a human-friendly relative time string
 * Examples: "just now", "5m ago", "2h ago", "3d ago", "Jan 15" (localized via active locale)
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) {
    return i18n.t("time.justNow");
  }

  if (diffMin < 1) {
    return i18n.t("time.relative.secondsAgo", { value: diffSec });
  }

  if (diffHour < 1) {
    return i18n.t("time.relative.minutesAgo", { value: diffMin });
  }

  if (diffDay < 1) {
    return i18n.t("time.relative.hoursAgo", { value: diffHour });
  }

  if (diffDay < 7) {
    return i18n.t("time.relative.daysAgo", { value: diffDay });
  }

  // For older dates, show abbreviated month and day in the active locale.
  const month = date.toLocaleDateString(getActiveLocale(), { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Cached Intl formatters, keyed by active locale so switching language rebuilds them.
// Explicitly carrying `hourCycle` from the resolved options is what makes the runtime
// respect the user's OS-level 12h/24h preference rather than the locale's default cycle.
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getTimeFormatter(): Intl.DateTimeFormat {
  const locale = getActiveLocale();
  const cached = timeFormatterCache.get(locale);
  if (cached) return cached;
  const resolved = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).resolvedOptions();
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: resolved.hourCycle,
  });
  timeFormatterCache.set(locale, formatter);
  return formatter;
}

/**
 * Format a chat-message timestamp for hover-revealed UI.
 * - Same day: "10:11 PM" or "22:11" depending on user preference
 * - Within ~6 days: "Wednesday 10:11 PM"
 * - Older: "14 May 2026, 10:11 PM"
 */
export function formatMessageTimestamp(date: Date, now: Date = new Date()): string {
  const time = getTimeFormatter().format(date);

  if (isSameLocalDay(date, now)) {
    return time;
  }

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 7) {
    const weekday = date.toLocaleDateString(getActiveLocale(), { weekday: "long" });
    return `${weekday} ${time}`;
  }

  const dateLabel = date.toLocaleDateString(getActiveLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${dateLabel}, ${time}`;
}

/**
 * Format a duration as a compact human-readable string.
 * - 0-60s: whole seconds ("47s")
 * - Minutes/hours: integers only ("2m 12s", "1h 5m")
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return i18n.t("time.duration.seconds", { value: 0 });
  }
  const totalSeconds = durationMs / 1000;

  if (totalSeconds < 60) {
    return i18n.t("time.duration.seconds", { value: Math.floor(totalSeconds) });
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds) % 60;
    return seconds === 0
      ? i18n.t("time.duration.minutes", { value: totalMinutes })
      : i18n.t("time.duration.minutesSeconds", { minutes: totalMinutes, seconds });
  }
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return remMinutes === 0
    ? i18n.t("time.duration.hours", { value: hours })
    : i18n.t("time.duration.hoursMinutes", { hours, minutes: remMinutes });
}
