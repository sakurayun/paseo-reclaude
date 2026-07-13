import { describe, expect, it } from "vitest";
import { MONO_FALLBACK_LIGATURES } from "@/styles/mono-ligatures";
import { findTerminalLigatureRanges } from "./terminal-ligature-ranges";

describe("findTerminalLigatureRanges", () => {
  it("joins common programming sequences used while typing", () => {
    expect(findTerminalLigatureRanges("const f = x => x + 1", MONO_FALLBACK_LIGATURES)).toEqual([
      [12, 14], // =>
    ]);
    expect(findTerminalLigatureRanges("a->b", MONO_FALLBACK_LIGATURES)).toEqual([[1, 3]]);
    expect(findTerminalLigatureRanges("a !== b", MONO_FALLBACK_LIGATURES)).toEqual([[2, 5]]);
    expect(findTerminalLigatureRanges("a <= b >= c", MONO_FALLBACK_LIGATURES)).toEqual([
      [2, 4],
      [7, 9],
    ]);
  });

  it("prefers longer sequences first", () => {
    expect(findTerminalLigatureRanges("a===b", MONO_FALLBACK_LIGATURES)).toEqual([[1, 4]]);
    expect(findTerminalLigatureRanges("a!==b", MONO_FALLBACK_LIGATURES)).toEqual([[1, 4]]);
  });

  it("finds multiple non-overlapping joins on one line", () => {
    expect(findTerminalLigatureRanges("a => b && c", MONO_FALLBACK_LIGATURES)).toEqual([
      [2, 4],
      [7, 9],
    ]);
  });

  it("returns empty for plain text", () => {
    expect(findTerminalLigatureRanges("hello world", MONO_FALLBACK_LIGATURES)).toEqual([]);
  });
});
