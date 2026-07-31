import { describe, expect, it } from "vitest";
import { breakableMonoText } from "./breakable-mono-text";

describe("breakableMonoText", () => {
  it("leaves short tokens alone", () => {
    expect(breakableMonoText("fence")).toBe("fence");
    expect(breakableMonoText("code_block")).toBe("code_block");
  });

  it("inserts break opportunities after path separators in long paths", () => {
    const input = "packages/app/src/styles/markdown-styles.ts";
    const result = breakableMonoText(input);
    expect(result.includes("\u200b")).toBe(true);
    expect(result.replaceAll("\u200b", "")).toBe(input);
    expect(result).toContain("/\u200b");
    expect(result).toContain(".\u200b");
  });
});
