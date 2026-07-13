import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissSshTab,
  filterOutDismissedSshTerminalIds,
  undismissSshTab,
  undismissSshTabEverywhere,
  useSshTabDismissedStore,
} from "./ssh-tab-dismissed-store";

describe("ssh-tab-dismissed-store", () => {
  beforeEach(() => {
    useSshTabDismissedStore.setState({ dismissedByWorkspace: {} });
  });

  it("dismisses a terminal for one workspace only", () => {
    dismissSshTab("srv:ws-a", "term-1");
    expect(useSshTabDismissedStore.getState().isDismissed("srv:ws-a", "term-1")).toBe(true);
    expect(useSshTabDismissedStore.getState().isDismissed("srv:ws-b", "term-1")).toBe(false);
  });

  it("filters dismissed ids from auto-open lists", () => {
    dismissSshTab("srv:ws-a", "term-1");
    expect(
      filterOutDismissedSshTerminalIds({
        workspaceKey: "srv:ws-a",
        terminalIds: ["term-1", "term-2"],
      }),
    ).toEqual(["term-2"]);
  });

  it("undismisses when the user reopens an SSH tab", () => {
    dismissSshTab("srv:ws-a", "term-1");
    undismissSshTab("srv:ws-a", "term-1");
    expect(useSshTabDismissedStore.getState().isDismissed("srv:ws-a", "term-1")).toBe(false);
  });

  it("undismisses everywhere when the shell is killed or reconnected", () => {
    dismissSshTab("srv:ws-a", "term-1");
    dismissSshTab("srv:ws-b", "term-1");
    undismissSshTabEverywhere("term-1");
    expect(useSshTabDismissedStore.getState().isDismissed("srv:ws-a", "term-1")).toBe(false);
    expect(useSshTabDismissedStore.getState().isDismissed("srv:ws-b", "term-1")).toBe(false);
  });
});
