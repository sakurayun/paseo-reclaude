import { describe, expect, it } from "vitest";
import { MONO_FALLBACK_LIGATURES, monoLigatureTextStyle } from "@/styles/mono-ligatures";

describe("mono ligatures", () => {
  it("includes common programming sequences in the fallback list", () => {
    for (const seq of ["=>", "->", "!==", "===", "<=", ">=", "&&", "||", "..."]) {
      expect(MONO_FALLBACK_LIGATURES).toContain(seq);
    }
  });

  it("returns a style object for enabled and disabled states", () => {
    expect(monoLigatureTextStyle(true)).toBeTypeOf("object");
    expect(monoLigatureTextStyle(false)).toBeTypeOf("object");
  });
});
