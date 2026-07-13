import { describe, expect, it } from "vitest";
import { buildRemoteCdCommand, joinRemotePath, remoteParentDir } from "./remote-path";

describe("remote path helpers", () => {
  it("joins destination and relative paths", () => {
    expect(joinRemotePath("~", "a/b.txt")).toBe("~/a/b.txt");
    expect(joinRemotePath("~/incoming/", "a.txt")).toBe("~/incoming/a.txt");
    expect(joinRemotePath("/data", "x/y")).toBe("/data/x/y");
    expect(joinRemotePath("  ", "a")).toBe("~/a");
  });

  it("computes remote parent directories", () => {
    expect(remoteParentDir("~/a/b.txt")).toBe("~/a");
    expect(remoteParentDir("/data/file")).toBe("/data");
    expect(remoteParentDir("/file")).toBe("/");
    expect(remoteParentDir("~")).toBe("~");
  });

  it("builds POSIX cd commands with tilde outside quotes", () => {
    expect(buildRemoteCdCommand("~", "linux")).toBe("cd ~\r");
    expect(buildRemoteCdCommand("~/my dir", "linux")).toBe("cd ~/'my dir'\r");
    expect(buildRemoteCdCommand("/srv/it's", "darwin")).toBe("cd '/srv/it'\\''s'\r");
  });

  it("builds Windows cd commands", () => {
    expect(buildRemoteCdCommand("C:/Users/dev", "windows")).toBe("cd C:/Users/dev\r");
    expect(buildRemoteCdCommand("C:/My Files", "windows")).toBe('cd "C:/My Files"\r');
  });
});
