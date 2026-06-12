import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

describe("md5Hex", () => {
  // RFC 1321 test suite vectors.
  it("matches the RFC 1321 reference vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(
      md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("hashes multi-byte UTF-8 input", () => {
    // printf '中文' | md5
    expect(md5Hex("中文")).toBe("a7bac2239fcdcb3a067903d8077c4a07");
  });

  it("produces gravatar-style hashes for emails", () => {
    expect(md5Hex("user@example.com")).toBe("b58996c504c5638798eb6b511e6f49af");
  });
});
