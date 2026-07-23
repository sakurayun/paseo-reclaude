/**
 * Kitty-compatible OSC helpers used by the client terminal emulator.
 *
 * Full Kitty is a native GPU terminal with remote-control IPC and a Python
 * "kittens" runtime. Paseo is an xterm.js + WebGL client fed by a daemon PTY/
 * SSH stream, so we implement the escape-code protocols that fit that model:
 * desktop notifications (OSC 99 / OSC 9), ConEmu-style progress (OSC 9;4),
 * working-directory reports (OSC 7), and pointer shapes (OSC 22).
 *
 * Graphics (APC G) and the keyboard progressive-enhancement CSI u flags live
 * elsewhere (ImageAddon + TerminalInputModeTracker).
 */

export type TerminalProgressState =
  | { kind: "hidden" }
  | { kind: "indeterminate" }
  | { kind: "error"; percent: number | null }
  | { kind: "paused"; percent: number | null }
  | { kind: "normal"; percent: number };

export interface TerminalDesktopNotification {
  id: string;
  title: string;
  body: string;
  /** When true, send OSC 99 activation report if the user clicks. */
  report: boolean;
  /** When true, focus the terminal surface if the user clicks. */
  focus: boolean;
  /** When true, send OSC 99 close report when the notification is dismissed. */
  reportClose: boolean;
  urgency: "low" | "normal" | "critical" | null;
  appName: string | null;
}

export interface KittyOsc99QueryResponse {
  /** Full response sequence including OSC prefix and ST terminator. */
  sequence: string;
}

export interface KittyOscParseResult {
  /** Consume the OSC (do not leave raw text in the buffer). */
  handled: boolean;
  notification?: TerminalDesktopNotification;
  /** Reply sequence(s) to inject as terminal input (PTY stdin). */
  responses?: string[];
  progress?: TerminalProgressState;
  cwd?: string;
  pointerShape?: string | null;
  /** Close a previously shown notification by id. */
  closeNotificationId?: string;
}

const ST = "\x1b\\";
const MAX_NOTIFICATION_CHARS = 4_096;
const DEFAULT_NOTIFICATION_ID = "0";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function decodeMaybeBase64(value: string, encoded: boolean): string {
  if (!encoded) {
    return value;
  }
  try {
    // Browser / RN webview
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  } catch {
    // fall through
  }
  try {
    // Node test environment
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function truncateNotificationText(value: string): string {
  if (value.length <= MAX_NOTIFICATION_CHARS) {
    return value;
  }
  return value.slice(0, MAX_NOTIFICATION_CHARS);
}

function parseMetadata(metadata: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!metadata.trim()) {
    return map;
  }
  for (const part of metadata.split(":")) {
    if (!part) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (!/^[a-zA-Z]$/.test(key)) {
      continue;
    }
    const existing = map.get(key);
    if (existing) {
      existing.push(value);
    } else {
      map.set(key, [value]);
    }
  }
  return map;
}

function firstMeta(map: Map<string, string[]>, key: string): string | undefined {
  return map.get(key)?.[0];
}

function parseActions(raw: string | undefined): { report: boolean; focus: boolean } {
  // Default per Kitty: focus on click.
  let report = false;
  let focus = true;
  if (!raw) {
    return { report, focus };
  }
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "report" || trimmed === "+report") {
      report = true;
    } else if (trimmed === "-report") {
      report = false;
    } else if (trimmed === "focus" || trimmed === "+focus") {
      focus = true;
    } else if (trimmed === "-focus") {
      focus = false;
    }
  }
  return { report, focus };
}

function parseUrgency(raw: string | undefined): TerminalDesktopNotification["urgency"] {
  if (raw === "0") return "low";
  if (raw === "1") return "normal";
  if (raw === "2") return "critical";
  return null;
}

/**
 * OSC 99 — Kitty desktop notifications.
 * Form: `OSC 99 ; metadata ; payload ST`
 */
export function parseKittyOsc99(data: string): KittyOscParseResult {
  // xterm delivers OSC data without the `99;` prefix when registered for code 99.
  // Some paths may include it; normalize.
  const body = data.startsWith("99;") ? data.slice(3) : data;
  const firstSemi = body.indexOf(";");
  const metadataRaw = firstSemi === -1 ? body : body.slice(0, firstSemi);
  const payloadRaw = firstSemi === -1 ? "" : body.slice(firstSemi + 1);
  const meta = parseMetadata(metadataRaw);
  const id = firstMeta(meta, "i") ?? DEFAULT_NOTIFICATION_ID;
  const payloadType = firstMeta(meta, "p") ?? "title";
  const encoded = firstMeta(meta, "e") === "1";
  const done = firstMeta(meta, "d") !== "0";

  if (payloadType === "?") {
    // Capability query response — subset we actually implement.
    const response = `\x1b]99;i=${id}:p=?;a=report,focus:c=1:o=always:p=title,body,close:s=system,silent:u=0,1,2:w=1${ST}`;
    return { handled: true, responses: [response] };
  }

  if (payloadType === "close" && !payloadRaw) {
    return { handled: true, closeNotificationId: id };
  }

  if (payloadType === "alive") {
    // We don't keep a durable OS-side id list; reply empty alive set.
    return {
      handled: true,
      responses: [`\x1b]99;i=${id}:p=alive;${ST}`],
    };
  }

  // Accumulate title/body for chunked notifications in the caller via pending map.
  const decodedPayload = truncateNotificationText(decodeMaybeBase64(payloadRaw, encoded));
  const { report, focus } = parseActions(firstMeta(meta, "a"));
  const reportClose = firstMeta(meta, "c") === "1";
  const urgency = parseUrgency(firstMeta(meta, "u"));
  const appNameRaw = firstMeta(meta, "f");
  const appName = appNameRaw ? decodeMaybeBase64(appNameRaw, true) : null;

  if (payloadType === "title" || payloadType === "body") {
    return {
      handled: true,
      notification: {
        id,
        title: payloadType === "title" ? decodedPayload : "",
        body: payloadType === "body" ? decodedPayload : "",
        report,
        focus,
        reportClose,
        urgency,
        appName,
      },
      // Partial chunks (d=0) are assembled by the accumulator; only "done" flushes.
      // We always return a notification fragment; the accumulator decides when to show.
      ...(done
        ? {}
        : {
            /* incomplete fragment */
          }),
    };
  }

  // Unknown payload type — ignore but consume so it doesn't pollute the screen.
  return { handled: true };
}

/**
 * Accumulates chunked OSC 99 notifications until d=1 (or absent, treated as done).
 */
export class KittyNotificationAccumulator {
  private readonly pending = new Map<
    string,
    {
      title: string;
      body: string;
      report: boolean;
      focus: boolean;
      reportClose: boolean;
      urgency: TerminalDesktopNotification["urgency"];
      appName: string | null;
    }
  >();

  ingest(fragment: TerminalDesktopNotification, done: boolean): TerminalDesktopNotification | null {
    const existing = this.pending.get(fragment.id) ?? {
      title: "",
      body: "",
      report: fragment.report,
      focus: fragment.focus,
      reportClose: fragment.reportClose,
      urgency: fragment.urgency,
      appName: fragment.appName,
    };
    if (fragment.title) {
      existing.title += fragment.title;
    }
    if (fragment.body) {
      existing.body += fragment.body;
    }
    // Latest flags win.
    existing.report = fragment.report;
    existing.focus = fragment.focus;
    existing.reportClose = fragment.reportClose;
    if (fragment.urgency) {
      existing.urgency = fragment.urgency;
    }
    if (fragment.appName) {
      existing.appName = fragment.appName;
    }
    this.pending.set(fragment.id, existing);

    if (!done) {
      return null;
    }

    this.pending.delete(fragment.id);
    const title = existing.title.trim() || existing.body.trim() || "Notification";
    const body = existing.title.trim() ? existing.body.trim() : "";
    return {
      id: fragment.id,
      title: truncateNotificationText(title),
      body: truncateNotificationText(body),
      report: existing.report,
      focus: existing.focus,
      reportClose: existing.reportClose,
      urgency: existing.urgency,
      appName: existing.appName,
    };
  }

  clear(): void {
    this.pending.clear();
  }
}

/** Detect whether OSC 99 data ends an incomplete (d=0) chunk. */
export function isKittyOsc99Done(data: string): boolean {
  const body = data.startsWith("99;") ? data.slice(3) : data;
  const firstSemi = body.indexOf(";");
  const metadataRaw = firstSemi === -1 ? body : body.slice(0, firstSemi);
  const meta = parseMetadata(metadataRaw);
  return firstMeta(meta, "d") !== "0";
}

/**
 * OSC 9 — iTerm2 / Kitty legacy single-string desktop notification,
 * or ConEmu progress when the payload starts with `4;`.
 */
export function parseOsc9(data: string): KittyOscParseResult {
  const body = data.startsWith("9;") ? data.slice(2) : data;

  // ConEmu / Windows Terminal progress: OSC 9 ; 4 ; <state> ; <progress> ST
  if (body.startsWith("4;")) {
    const parts = body.split(";");
    // parts[0] === "4"
    const state = Number(parts[1] ?? "0");
    const progressRaw = parts[2] !== undefined ? Number(parts[2]) : null;
    const percent =
      progressRaw !== null && Number.isFinite(progressRaw) ? clampPercent(progressRaw) : null;

    switch (state) {
      case 0:
        return { handled: true, progress: { kind: "hidden" } };
      case 1:
        return {
          handled: true,
          progress: { kind: "normal", percent: percent ?? 0 },
        };
      case 2:
        return { handled: true, progress: { kind: "error", percent } };
      case 3:
        return { handled: true, progress: { kind: "indeterminate" } };
      case 4:
        return { handled: true, progress: { kind: "paused", percent } };
      default:
        return { handled: true, progress: { kind: "hidden" } };
    }
  }

  const text = truncateNotificationText(body.trim());
  if (!text) {
    return { handled: true };
  }
  return {
    handled: true,
    notification: {
      id: DEFAULT_NOTIFICATION_ID,
      title: text,
      body: "",
      report: false,
      focus: true,
      reportClose: false,
      urgency: null,
      appName: null,
    },
  };
}

/**
 * OSC 7 — report working directory.
 * Common forms:
 *   file://hostname/path
 *   file:///path
 *   kitty-shell-cwd://hostname/path
 *   plain absolute path
 */
export function parseOsc7(data: string): KittyOscParseResult {
  const body = data.startsWith("7;") ? data.slice(2) : data;
  const trimmed = body.trim();
  if (!trimmed) {
    return { handled: true };
  }

  try {
    if (trimmed.startsWith("file:") || trimmed.startsWith("kitty-shell-cwd:")) {
      const url = new URL(trimmed);
      let path = decodeURIComponent(url.pathname || "");
      // file://hostname/path on Unix yields pathname "/path"; keep Windows drive paths.
      if (/^\/[A-Za-z]:\//.test(path)) {
        path = path.slice(1);
      }
      if (path) {
        return { handled: true, cwd: path };
      }
    }
  } catch {
    // fall through to plain path
  }

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { handled: true, cwd: trimmed };
  }

  return { handled: true };
}

/**
 * OSC 22 — set mouse pointer shape (Kitty / xterm).
 * Empty / "default" resets.
 */
export function parseOsc22(data: string): KittyOscParseResult {
  const body = data.startsWith("22;") ? data.slice(3) : data;
  const shape = body.trim();
  if (!shape || shape === "default" || shape === "auto") {
    return { handled: true, pointerShape: null };
  }
  // Allow a small CSS cursor whitelist; unknown shapes reset.
  const allowed = new Set([
    "default",
    "pointer",
    "text",
    "crosshair",
    "move",
    "wait",
    "help",
    "not-allowed",
    "progress",
    "cell",
    "grab",
    "grabbing",
    "col-resize",
    "row-resize",
    "n-resize",
    "s-resize",
    "e-resize",
    "w-resize",
    "ne-resize",
    "nw-resize",
    "se-resize",
    "sw-resize",
    "ew-resize",
    "ns-resize",
    "nesw-resize",
    "nwse-resize",
    "zoom-in",
    "zoom-out",
    "copy",
    "alias",
    "context-menu",
    "no-drop",
    "all-scroll",
    "vertical-text",
  ]);
  return {
    handled: true,
    pointerShape: allowed.has(shape) ? shape : null,
  };
}

export function buildKittyOsc99ActivationReport(id: string): string {
  return `\x1b]99;i=${id || DEFAULT_NOTIFICATION_ID};${ST}`;
}

export function buildKittyOsc99CloseReport(id: string): string {
  return `\x1b]99;i=${id || DEFAULT_NOTIFICATION_ID}:p=close;${ST}`;
}
