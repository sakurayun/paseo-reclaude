import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleRunSchema, ScheduleTargetSchema } from "./types.js";

describe("ScheduleCadenceSchema", () => {
  test("accepts existing UTC cron cadence without a time zone", () => {
    expect(ScheduleCadenceSchema.parse({ type: "cron", expression: "0 9 * * *" })).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  test("accepts timezone-aware cron cadence", () => {
    expect(
      ScheduleCadenceSchema.parse({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "America/New_York",
    });
  });
});

describe("ScheduleTargetSchema", () => {
  test("accepts an existing agent target with a UUID agent id", () => {
    expect(
      ScheduleTargetSchema.parse({
        type: "agent",
        agentId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({
      type: "agent",
      agentId: "00000000-0000-4000-8000-000000000000",
    });
  });
});

describe("ScheduleRunSchema", () => {
  test("accepts a completed run with a UUID agent id", () => {
    expect(
      ScheduleRunSchema.parse({
        id: "run-1",
        scheduledFor: "2026-06-18T00:00:00.000Z",
        startedAt: "2026-06-18T00:00:00.000Z",
        endedAt: "2026-06-18T00:00:01.000Z",
        status: "succeeded",
        agentId: "00000000-0000-4000-8000-000000000000",
        output: null,
        error: null,
      }),
    ).toMatchObject({
      status: "succeeded",
      agentId: "00000000-0000-4000-8000-000000000000",
    });
  });
});
