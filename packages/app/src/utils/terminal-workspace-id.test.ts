import { describe, expect, it } from "vitest";
import { isSyntheticTerminalWorkspaceId } from "./terminal-workspace-id";

describe("isSyntheticTerminalWorkspaceId", () => {
  it("flags standalone and legacy ssh buckets", () => {
    expect(isSyntheticTerminalWorkspaceId("standalone:/tmp/dir")).toBe(true);
    expect(isSyntheticTerminalWorkspaceId("ssh:host-1")).toBe(true);
  });

  it("accepts real workspace ids", () => {
    expect(isSyntheticTerminalWorkspaceId("/repo/worktree")).toBe(false);
    expect(isSyntheticTerminalWorkspaceId("ws-opaque-id")).toBe(false);
  });
});
