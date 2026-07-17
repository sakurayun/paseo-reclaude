import { describe, expect, it } from "vitest";
import { formatErrorForLog, toErrorMessage } from "./error-messages";

describe("toErrorMessage", () => {
  it("reads Error.message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("reads message from plain objects instead of [object Object]", () => {
    expect(toErrorMessage({ message: "nope" })).toBe("nope");
    expect(toErrorMessage({ code: "EFAIL", detail: 1 })).toContain("EFAIL");
  });

  it("stringifies primitives", () => {
    expect(toErrorMessage("x")).toBe("x");
    expect(toErrorMessage(42)).toBe("42");
  });
});

describe("formatErrorForLog", () => {
  it("exposes name/message/stack for Error instances", () => {
    const error = new Error("sync failed");
    const formatted = formatErrorForLog(error);
    expect(formatted.message).toBe("sync failed");
    expect(formatted.name).toBe("Error");
    expect(typeof formatted.stack).toBe("string");
  });

  it("includes nested cause", () => {
    const error = new Error("outer", { cause: new Error("inner") });
    const formatted = formatErrorForLog(error);
    expect(formatted.cause?.message).toBe("inner");
  });

  it("surfaces message for object-shaped failures", () => {
    const formatted = formatErrorForLog({ message: "agent not found", code: 404 });
    expect(formatted.message).toBe("agent not found");
    expect(formatted.value).toEqual({ message: "agent not found", code: 404 });
  });
});
