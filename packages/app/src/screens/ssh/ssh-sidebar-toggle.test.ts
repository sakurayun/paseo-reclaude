import { describe, expect, it } from "vitest";
import { resolveSshExitWorkspace } from "./ssh-sidebar-toggle";

const entry = { serverId: "srv-a", workspaceId: "ws-entry" };
const last = { serverId: "srv-a", workspaceId: "ws-last" };

describe("resolveSshExitWorkspace", () => {
  it("returns the entry workspace when exiting from the /ssh page", () => {
    expect(
      resolveSshExitWorkspace({ pathname: "/ssh", entrySelection: entry, lastSelection: last }),
    ).toEqual(entry);
  });

  it("falls back to the last active workspace when no entry snapshot exists", () => {
    expect(
      resolveSshExitWorkspace({ pathname: "/ssh", entrySelection: null, lastSelection: last }),
    ).toEqual(last);
  });

  it("returns null when there is no workspace to return to", () => {
    expect(
      resolveSshExitWorkspace({ pathname: "/ssh", entrySelection: null, lastSelection: null }),
    ).toBeNull();
  });

  it("does not navigate when the main panel already left the /ssh page", () => {
    expect(
      resolveSshExitWorkspace({
        pathname: "/h/srv-a/workspace/ws-1",
        entrySelection: entry,
        lastSelection: last,
      }),
    ).toBeNull();
  });
});
