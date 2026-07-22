import { describe, expect, it } from "vitest";
import { shouldFollowToolCallDetailEnd } from "./tool-call-detail-follow";

describe("shouldFollowToolCallDetailEnd", () => {
  it.each(["running", "executing"] as const)(
    "follows streaming thinking content while status is %s",
    (status) => {
      expect(shouldFollowToolCallDetailEnd("thinking", status)).toBe(true);
    },
  );

  it.each(["completed", "failed", "canceled"] as const)(
    "stops following thinking content when status is %s",
    (status) => {
      expect(shouldFollowToolCallDetailEnd("thinking", status)).toBe(false);
    },
  );

  it("does not change scrolling behavior for other tool calls", () => {
    expect(shouldFollowToolCallDetailEnd("shell", "executing")).toBe(false);
  });
});
