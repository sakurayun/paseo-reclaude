import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatDuration, formatMessageTimestamp, formatTimeAgo } from "./time";

describe("formatTimeAgo (relative labels)", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it.each([
    ["2026-07-16T11:59:55.000Z", "just now"],
    ["2026-07-16T11:59:30.000Z", "30s ago"],
    ["2026-07-16T11:55:00.000Z", "5m ago"],
    ["2026-07-16T10:00:00.000Z", "2h ago"],
    ["2026-07-13T12:00:00.000Z", "3d ago"],
    ["2026-01-15T12:00:00.000Z", "Jan 15"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatTimeAgo(new Date(date), now)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it("renders sub-minute durations as whole seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(5_600)).toBe("5s");
    expect(formatDuration(9_900)).toBe("9s");
    expect(formatDuration(10_400)).toBe("10s");
    expect(formatDuration(12_340)).toBe("12s");
    expect(formatDuration(47_000)).toBe("47s");
  });

  it("renders minutes and remainder seconds without decimals", () => {
    expect(formatDuration(75_230)).toBe("1m 15s");
    expect(formatDuration(132_000)).toBe("2m 12s");
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("renders hours and remainder minutes without decimals", () => {
    expect(formatDuration(3_900_000)).toBe("1h 5m");
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("guards against negative and NaN", () => {
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
  });
});

describe("formatTimeAgo", () => {
  // 2026-06-23 is "now"; 2026-06-15 is 8 days back → the older-date branch that
  // renders an absolute "month day" label in the active locale.
  const now = new Date(2026, 5, 23, 12, 0);
  const olderDate = new Date(2026, 5, 15, 9, 0);

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the abbreviated month and day in English", () => {
    expect(formatTimeAgo(olderDate, now)).toBe("Jun 15");
  });

  it("keeps the localized day suffix in Chinese (regression: '6月15日', not '6月 15')", async () => {
    await i18n.changeLanguage("zh-CN");
    const result = formatTimeAgo(olderDate, now);
    expect(result).toBe("6月15日");
    // The old hand-concatenation produced "6月 15": day number with no 日 suffix.
    expect(result).toContain("日");
    expect(result).not.toMatch(/月\s/);
  });

  it("still shows relative labels for recent timestamps", () => {
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    expect(formatTimeAgo(fiveMinAgo, now)).toBe("5m ago");
  });
});

describe("formatMessageTimestamp", () => {
  it("shows only time for same-day timestamps", () => {
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 4, 14, 12, 23);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/12:23/);
    expect(formatted).not.toMatch(/Thursday|Wednesday/);
  });

  it("includes weekday for timestamps within the last 6 days", () => {
    // 2026-05-14 is a Thursday. 2026-05-11 is a Monday.
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 4, 11, 22, 12);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/Monday/);
    expect(formatted).toMatch(/10:12 PM|22:12/);
  });

  it("includes full date for older timestamps", () => {
    const now = new Date(2026, 4, 14, 17, 30);
    const date = new Date(2026, 3, 1, 9, 5);
    const formatted = formatMessageTimestamp(date, now);
    expect(formatted).toMatch(/Apr|April/);
    expect(formatted).toMatch(/2026/);
  });
});
