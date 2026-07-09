import { describe, expect, it } from "vitest";
import { buildSshRoute, isSshSection, SSH_SECTIONS } from "./ssh-navigation";

describe("ssh-navigation", () => {
  it("recognizes valid sections and rejects others", () => {
    for (const section of SSH_SECTIONS) {
      expect(isSshSection(section)).toBe(true);
    }
    expect(isSshSection("bogus")).toBe(false);
    expect(isSshSection(undefined)).toBe(false);
  });

  it("builds a section route", () => {
    expect(buildSshRoute("keychain")).toBe("/ssh?section=keychain");
    expect(buildSshRoute("hosts")).toBe("/ssh?section=hosts");
  });
});
