/**
 * OSC 99 desktop-notification activation / close reports.
 *
 * Kitty tools that request `a=report` or `c=1` expect the terminal to inject
 * OSC 99 replies on the PTY stdin when the OS notification is clicked or
 * dismissed. The React notification layer stores these flags in the OS
 * notification `data` payload; this module parses that payload and injects
 * the matching sequences via the daemon client.
 */

import { useSessionStore } from "@/stores/session-store";
import {
  buildKittyOsc99ActivationReport,
  buildKittyOsc99CloseReport,
} from "./terminal-kitty-protocols";

export const TERMINAL_NOTIFICATION_KIND = "terminal-notification";

export interface TerminalNotificationOsData {
  kind: typeof TERMINAL_NOTIFICATION_KIND;
  serverId: string;
  terminalId: string;
  notificationId: string;
  workspaceId: string | null;
  report: boolean;
  focus: boolean;
  reportClose: boolean;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return fallback;
}

export function isTerminalNotificationOsData(
  data: Record<string, unknown> | null | undefined,
): data is Record<string, unknown> & {
  kind: typeof TERMINAL_NOTIFICATION_KIND;
} {
  return data?.kind === TERMINAL_NOTIFICATION_KIND;
}

export function parseTerminalNotificationOsData(
  data: Record<string, unknown> | null | undefined,
): TerminalNotificationOsData | null {
  if (!isTerminalNotificationOsData(data)) {
    return null;
  }
  const serverId = readNonEmptyString(data.serverId);
  const terminalId = readNonEmptyString(data.terminalId);
  if (!serverId || !terminalId) {
    return null;
  }
  return {
    kind: TERMINAL_NOTIFICATION_KIND,
    serverId,
    terminalId,
    notificationId: readNonEmptyString(data.notificationId) ?? "0",
    workspaceId: readNonEmptyString(data.workspaceId),
    report: readBooleanFlag(data.report, false),
    focus: readBooleanFlag(data.focus, true),
    reportClose: readBooleanFlag(data.reportClose, false),
  };
}

export function buildTerminalNotificationOsData(input: {
  serverId: string;
  terminalId: string;
  notificationId: string;
  workspaceId?: string | null;
  report: boolean;
  focus: boolean;
  reportClose: boolean;
}): Record<string, unknown> {
  return {
    kind: TERMINAL_NOTIFICATION_KIND,
    serverId: input.serverId,
    terminalId: input.terminalId,
    notificationId: input.notificationId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    report: input.report,
    focus: input.focus,
    reportClose: input.reportClose,
  };
}

function sendTerminalOscInput(input: {
  serverId: string;
  terminalId: string;
  sequence: string;
}): boolean {
  const client = useSessionStore.getState().sessions[input.serverId]?.client ?? null;
  if (!client || input.sequence.length === 0) {
    return false;
  }
  client.sendTerminalInput(input.terminalId, {
    type: "input",
    data: input.sequence,
  });
  return true;
}

/**
 * Inject OSC 99 activation report when the user clicks a terminal notification.
 * Returns whether a report was requested and successfully sent.
 */
export function reportTerminalNotificationActivated(
  data: Record<string, unknown> | null | undefined,
): { handled: boolean; reported: boolean; shouldFocus: boolean } {
  const parsed = parseTerminalNotificationOsData(data);
  if (!parsed) {
    return { handled: false, reported: false, shouldFocus: false };
  }

  let reported = false;
  if (parsed.report) {
    reported = sendTerminalOscInput({
      serverId: parsed.serverId,
      terminalId: parsed.terminalId,
      sequence: buildKittyOsc99ActivationReport(parsed.notificationId),
    });
  }

  if (parsed.focus) {
    useSessionStore.getState().setFocusedTerminalId(parsed.serverId, parsed.terminalId);
  }

  return { handled: true, reported, shouldFocus: parsed.focus };
}

/**
 * Inject OSC 99 close report when a terminal notification is dismissed.
 */
export function reportTerminalNotificationClosed(
  data: Record<string, unknown> | null | undefined,
): { handled: boolean; reported: boolean } {
  const parsed = parseTerminalNotificationOsData(data);
  if (!parsed) {
    return { handled: false, reported: false };
  }
  if (!parsed.reportClose) {
    return { handled: true, reported: false };
  }

  const reported = sendTerminalOscInput({
    serverId: parsed.serverId,
    terminalId: parsed.terminalId,
    sequence: buildKittyOsc99CloseReport(parsed.notificationId),
  });
  return { handled: true, reported };
}
