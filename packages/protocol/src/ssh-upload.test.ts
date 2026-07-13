import { describe, expect, it } from "vitest";
import { buildSshUploadFrameId, isSshUploadFrameId, parseSshUploadFrameId } from "./ssh-upload.js";

describe("ssh upload frame ids", () => {
  it("round-trips upload and file ids", () => {
    const frameId = buildSshUploadFrameId("u_1-A", "f_2-B");
    expect(isSshUploadFrameId(frameId)).toBe(true);
    expect(parseSshUploadFrameId(frameId)).toEqual({ uploadId: "u_1-A", fileId: "f_2-B" });
  });

  it("rejects ids containing the separator or other unsafe characters", () => {
    expect(() => buildSshUploadFrameId("a:b", "c")).toThrow(RangeError);
    expect(() => buildSshUploadFrameId("a", "c/d")).toThrow(RangeError);
  });

  it("returns null for non-upload requestIds", () => {
    expect(parseSshUploadFrameId("some-request-id")).toBeNull();
    expect(isSshUploadFrameId("file-explorer:123")).toBe(false);
  });

  it("returns null for malformed upload frame ids", () => {
    expect(parseSshUploadFrameId("sshup:missing-separator")).toBeNull();
    expect(parseSshUploadFrameId("sshup::file")).toBeNull();
    expect(parseSshUploadFrameId("sshup:upload:")).toBeNull();
  });
});
