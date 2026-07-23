/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTerminalInput = vi.fn();
const setFocusedTerminalId = vi.fn();

vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: {
        "srv-1": {
          client: { sendTerminalInput },
        },
      },
      setFocusedTerminalId,
    }),
  },
}));

import {
  buildTerminalNotificationOsData,
  parseTerminalNotificationOsData,
  reportTerminalNotificationActivated,
  reportTerminalNotificationClosed,
} from "./terminal-desktop-notification-actions";

describe("terminal desktop notification actions", () => {
  beforeEach(() => {
    sendTerminalInput.mockReset();
    setFocusedTerminalId.mockReset();
  });

  it("builds and parses OS notification data payloads", () => {
    const data = buildTerminalNotificationOsData({
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      workspaceId: "ws-1",
      report: true,
      focus: false,
      reportClose: true,
    });
    expect(parseTerminalNotificationOsData(data)).toEqual({
      kind: "terminal-notification",
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      workspaceId: "ws-1",
      report: true,
      focus: false,
      reportClose: true,
    });
  });

  it("injects activation report and focuses when requested", () => {
    const result = reportTerminalNotificationActivated({
      kind: "terminal-notification",
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      report: true,
      focus: true,
      reportClose: false,
    });

    expect(result).toEqual({ handled: true, reported: true, shouldFocus: true });
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", {
      type: "input",
      data: "\x1b]99;i=job;\x1b\\",
    });
    expect(setFocusedTerminalId).toHaveBeenCalledWith("srv-1", "term-1");
  });

  it("skips activation inject and focus when flags are off", () => {
    const result = reportTerminalNotificationActivated({
      kind: "terminal-notification",
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      report: false,
      focus: false,
      reportClose: true,
    });

    expect(result).toEqual({ handled: true, reported: false, shouldFocus: false });
    expect(sendTerminalInput).not.toHaveBeenCalled();
    expect(setFocusedTerminalId).not.toHaveBeenCalled();
  });

  it("injects close report when c=1 was requested", () => {
    const result = reportTerminalNotificationClosed({
      kind: "terminal-notification",
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      report: true,
      focus: true,
      reportClose: true,
    });

    expect(result).toEqual({ handled: true, reported: true });
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", {
      type: "input",
      data: "\x1b]99;i=job:p=close;\x1b\\",
    });
  });

  it("ignores close when reportClose is false", () => {
    const result = reportTerminalNotificationClosed({
      kind: "terminal-notification",
      serverId: "srv-1",
      terminalId: "term-1",
      notificationId: "job",
      report: true,
      focus: true,
      reportClose: false,
    });
    expect(result).toEqual({ handled: true, reported: false });
    expect(sendTerminalInput).not.toHaveBeenCalled();
  });

  it("ignores non-terminal notification payloads", () => {
    expect(
      reportTerminalNotificationActivated({
        serverId: "srv-1",
        agentId: "agent-1",
      }),
    ).toEqual({ handled: false, reported: false, shouldFocus: false });
    expect(reportTerminalNotificationClosed({ agentId: "agent-1" })).toEqual({
      handled: false,
      reported: false,
    });
  });
});
