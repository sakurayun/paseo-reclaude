import * as pty from "node-pty";
import xterm, { type Terminal as TerminalType } from "@xterm/headless";
import { randomUUID } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, delimiter, dirname, extname, join, resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createExternalProcessEnv } from "../server/paseo-env.js";
import { writePrivateFileAtomicSync } from "../server/private-files.js";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import type { TerminalCell, TerminalState } from "@getpaseo/protocol/messages";
import { TerminalInputModeTracker } from "@getpaseo/protocol/terminal-input-mode";
import { TerminalActivityTracker } from "./activity/terminal-activity-tracker.js";
import type { TerminalActivity, TerminalActivityState } from "@getpaseo/protocol/terminal-activity";

const { Terminal } = xterm;
const require = createRequire(import.meta.url);
const PASEO_CLI_BIN_ENTRY = "@getpaseo/cli/bin/paseo";
let nodePtySpawnHelperChecked = false;
const TERMINAL_TITLE_DEBOUNCE_MS = 150;
const TERMINAL_EXIT_OUTPUT_LINE_LIMIT = 12;
const TERMINAL_EXIT_OUTPUT_CHAR_LIMIT = 16000;
const TERMINAL_OSC_COLOR_QUERY_RESPONSES = new Map<number, string>([
  [10, "rgb:e6e6/e6e6/e6e6"],
  [11, "rgb:0b0b/0b0b/0b0b"],
  [12, "rgb:e6e6/e6e6/e6e6"],
]);

export interface TerminalExitInfo {
  exitCode: number | null;
  signal: number | null;
  lastOutputLines: string[];
  // Stamped by the daemon-side mirror when the exit event lands; the worker
  // never sets it.
  endedAt?: number;
}

export interface TerminalCommandFinishedInfo {
  exitCode: number | null;
}

export interface TerminalStateSnapshot {
  state: TerminalState;
  revision: number;
  // Input-mode replay preamble at snapshot time. Populated by the terminal
  // worker so the daemon main loop doesn't have to re-derive it from output.
  replayPreamble?: string;
}

export interface TerminalStateSnapshotOptions {
  scrollbackLines?: number;
  // Include per-row soft-wrap flags (gridWrapped/scrollbackWrapped) so the client
  // can reflow restored content on resize. Gated on a client capability, so old
  // clients never receive the extra fields.
  includeWrapFlags?: boolean;
}

export interface TerminalSubscribeOptions {
  initialSnapshot?: "state" | "ready";
}

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; rows: number; cols: number }
  | { type: "mouse"; row: number; col: number; button: number; action: "down" | "up" | "move" };

export type ServerMessage =
  | { type: "output"; data: string; revision?: number }
  | { type: "snapshot"; state: TerminalState; revision?: number }
  | { type: "snapshotReady"; revision?: number; replayPreamble?: string }
  | { type: "titleChange"; title?: string };

export interface TerminalActivityTransition {
  activity: TerminalActivity | null;
  previous: TerminalActivity | null;
}

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  workspaceId: string;
  send(msg: ClientMessage): void;
  subscribe(listener: (msg: ServerMessage) => void, options?: TerminalSubscribeOptions): () => void;
  onExit(listener: (info: TerminalExitInfo) => void): () => void;
  onCommandFinished(listener: (info: TerminalCommandFinishedInfo) => void): () => void;
  onTitleChange(listener: (title?: string) => void): () => void;
  onActivityChange(listener: (transition: TerminalActivityTransition) => void): () => void;
  getSize(): { rows: number; cols: number };
  getState(): TerminalState;
  getStateSnapshot(options?: TerminalStateSnapshotOptions): TerminalStateSnapshot;
  getReplayPreamble(): string;
  getTitle(): string | undefined;
  getActivity(): TerminalActivity | null;
  setActivity(state: TerminalActivityState): void;
  clearActivityAttention(): boolean;
  setTitle(title: string): void;
  getExitInfo(): TerminalExitInfo | null;
  kill(): void;
  killAndWait(options?: { gracefulTimeoutMs?: number; forceTimeoutMs?: number }): Promise<void>;
}

function parseCommandFinishedOsc(data: string): TerminalCommandFinishedInfo | null {
  // OSC 633 is terminal control traffic, but a foreground command can still
  // print arbitrary control bytes. Keep this boundary to the exact VS Code
  // command-finished shape emitted by our shell integration.
  const parts = data.split(";");
  if (parts[0] !== "D") {
    return null;
  }
  if (parts.length === 1) {
    return { exitCode: null };
  }
  if (parts.length !== 2 || !/^-?\d+$/.test(parts[1])) {
    return null;
  }
  return { exitCode: Number(parts[1]) };
}

export interface TerminalBackendExitEvent {
  exitCode: number | null;
  signal: number | null;
}

// Byte-transport abstraction under a terminal session. The default backend is
// a node-pty process; the SSH host manager plugs an ssh2 shell channel in via
// `CreateTerminalOptions.backend`. Everything above the backend (headless
// xterm, scrollback, DA1/OSC replies, activity, title) is backend-agnostic.
export interface TerminalBackend {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: TerminalBackendExitEvent) => void): void;
  waitForStart?(): Promise<void>;
}

export interface CreateTerminalOptions {
  id?: string;
  cwd: string;
  workspaceId: string;
  shell?: string;
  env?: Record<string, string>;
  activityEnv?: Record<string, string>;
  rows?: number;
  cols?: number;
  name?: string;
  title?: string;
  command?: string;
  args?: string[];
  // Windows-only default-shell preferences (pwsh7 / gsudo elevation). Ignored on
  // other platforms and when an explicit `command` is provided.
  windowsShell?: WindowsShellPreference;
  // When set, the terminal attaches to this transport instead of spawning a
  // pty process (command/shell/windowsShell are ignored).
  backend?: TerminalBackend;
}

function toTerminalActivity(snapshot: {
  state: TerminalActivityState | null;
  attentionReason?: TerminalActivity["attentionReason"];
  changedAt: number;
}): TerminalActivity | null {
  if (!snapshot.state) {
    return null;
  }
  return {
    state: snapshot.state,
    ...(snapshot.attentionReason ? { attentionReason: snapshot.attentionReason } : {}),
    changedAt: snapshot.changedAt,
  };
}

function resolveInitialTitleMode(presetTitle: string | undefined): "auto" | "manual" {
  return presetTitle?.trim() ? "manual" : "auto";
}

interface BuildTerminalEnvironmentInput {
  shell: string;
  env: Record<string, string>;
  zshShellIntegrationDir?: string;
  paseoCliBinDir?: string | null;
  paseoHookCliPath?: string | null;
}

interface EnsureNodePtySpawnHelperExecutableOptions {
  packageRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  force?: boolean;
}

interface WindowsPtyProcessReadiness {
  _agent?: { innerPid?: number };
}

function resolveNodePtyPackageRoot(): string | null {
  try {
    const packageJsonPath = require.resolve("node-pty/package.json");
    return dirname(packageJsonPath);
  } catch {
    return null;
  }
}

function ensureExecutableBit(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    return;
  }
  // node-pty 1.1.0 shipped darwin prebuild spawn-helper without execute bit.
  if ((stat.mode & 0o111) === 0o111) {
    return;
  }
  chmodSync(path, stat.mode | 0o111);
}

export function ensureNodePtySpawnHelperExecutableForCurrentPlatform(
  options: EnsureNodePtySpawnHelperExecutableOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return;
  }
  if (nodePtySpawnHelperChecked && !options.force) {
    return;
  }

  const packageRoot = options.packageRoot ?? resolveNodePtyPackageRoot();
  if (!packageRoot) {
    return;
  }
  const arch = options.arch ?? process.arch;

  const candidates = [
    join(packageRoot, "build", "Release", "spawn-helper"),
    join(packageRoot, "build", "Debug", "spawn-helper"),
    join(packageRoot, "prebuilds", `darwin-${arch}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    try {
      ensureExecutableBit(candidate);
    } catch {
      // best-effort hardening only
    }
  }

  if (!options.force) {
    nodePtySpawnHelperChecked = true;
  }
}

export function resolveDefaultTerminalShell(
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    return env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
  }

  return env.SHELL || "/bin/sh";
}

export interface ResolvedTerminalCommand {
  command: string;
  args: string[];
}

export interface ResolveTerminalSpawnCommandOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  resolveExecutable?: (name: string) => Promise<string | null>;
}

/**
 * Resolve a terminal profile command (e.g. `claude`) into something node-pty's
 * conpty backend can actually launch on Windows.
 *
 * On Windows, conpty's underlying `CreateProcess` does not apply `PATHEXT`, so a
 * bare `claude` (installed by npm as `claude.cmd`) fails with `error code: 2`
 * (`ERROR_FILE_NOT_FOUND`). Worse, conpty completes the spawn asynchronously on
 * its own conout worker thread, so that failure surfaces as an uncaught
 * exception that takes down the whole terminal worker process. Resolving the
 * real path up front — and routing `.cmd`/`.bat` shims through `cmd.exe /c`
 * (node-pty has no `shell` option) — keeps the profile launchable.
 *
 * Non-Windows and the default-shell path (no explicit command) are unchanged.
 */
export async function resolveTerminalSpawnCommand(
  command: string,
  args: string[],
  options: ResolveTerminalSpawnCommandOptions = {},
): Promise<ResolvedTerminalCommand> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command, args };
  }

  const resolveExecutable = options.resolveExecutable ?? findExecutable;
  const resolved = await resolveExecutable(command);
  if (!resolved) {
    // Leave the command as-is so the terminal itself surfaces the "not found"
    // error to the user instead of silently doing nothing.
    return { command, args };
  }

  // `.cmd`/`.bat` shims are batch scripts that conpty's CreateProcess cannot
  // launch directly; they must run through cmd.exe (node-pty has no `shell`
  // option, so build the `cmd /c` invocation ourselves). Checked by extension
  // rather than isWindowsCommandScript() because that helper gates on the live
  // process.platform, which is wrong once we're already on the win32 branch.
  const extension = extname(resolved).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    const env = options.env ?? process.env;
    const comSpec = env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    return { command: comSpec, args: ["/c", resolved, ...args] };
  }

  return { command: resolved, args };
}

/**
 * Per-terminal Windows shell preferences, sent by the client from its settings.
 * Only consulted on win32; ignored on every other platform.
 */
export interface WindowsShellPreference {
  // Prefer PowerShell 7 (`pwsh`) over Windows PowerShell 5.1 and cmd.exe.
  preferPowerShell7?: boolean;
  // Launch the shell elevated via gsudo (https://github.com/gerardog/gsudo).
  // conpty cannot elevate a child in place across the UAC boundary, so gsudo is
  // the only way to keep an elevated shell wired into the same embedded pipe.
  runAsAdmin?: boolean;
}

export interface ResolveDefaultShellSpawnOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  // Explicit shell override (internal callers, tests). When set, pwsh preference
  // is skipped — the caller picked the shell on purpose.
  shell?: string;
  windowsShell?: WindowsShellPreference;
  resolveExecutable?: (name: string) => Promise<string | null>;
  onWarn?: (message: string) => void;
}

function resolveWindowsComSpec(env: Record<string, string | undefined>): string {
  return env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
}

/**
 * Resolve the command used for a *default* (no explicit command) terminal.
 *
 * On non-Windows this is unchanged: the explicit shell or the login shell.
 *
 * On Windows it honours the per-terminal preferences:
 *  - `preferPowerShell7` walks `pwsh` → `powershell` → cmd.exe so a missing
 *    PowerShell 7 still degrades to something sensible instead of failing.
 *  - `runAsAdmin` wraps the resolved shell in `gsudo` when gsudo is installed,
 *    which keeps the elevated shell attached to the same conpty pipe. When gsudo
 *    is absent we cannot elevate, so we launch unelevated and warn once.
 */
export async function resolveDefaultShellSpawn(
  options: ResolveDefaultShellSpawnOptions = {},
): Promise<ResolvedTerminalCommand> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform !== "win32") {
    return { command: options.shell ?? resolveDefaultTerminalShell({ platform, env }), args: [] };
  }

  const resolveExecutable = options.resolveExecutable ?? findExecutable;
  const preference = options.windowsShell;

  let shellPath = options.shell ?? resolveWindowsComSpec(env);
  let shellArgs: string[] = [];

  if (!options.shell && preference?.preferPowerShell7) {
    const powerShell = (await resolveExecutable("pwsh")) ?? (await resolveExecutable("powershell"));
    if (powerShell) {
      shellPath = powerShell;
      // Skip the startup banner; the shell stays interactive by default.
      shellArgs = ["-NoLogo"];
    }
  }

  if (preference?.runAsAdmin) {
    const gsudo = await resolveExecutable("gsudo");
    if (gsudo) {
      return { command: gsudo, args: [shellPath, ...shellArgs] };
    }
    options.onWarn?.(
      "Admin terminal requested but 'gsudo' was not found on PATH; launching without elevation. " +
        "Install gsudo (https://github.com/gerardog/gsudo) to enable elevated terminals.",
    );
  }

  return { command: shellPath, args: shellArgs };
}

export function resolveZshShellIntegrationDir(): string {
  return fileURLToPath(new URL("./shell-integration/zsh", import.meta.url));
}

function resolveExternalProcessPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export function resolvePaseoCliBinDir(): string | null {
  const cliEntrypoint = resolvePaseoCliBinEntrypoint();
  if (!cliEntrypoint) {
    return null;
  }

  const externalCliEntrypoint = resolveExternalProcessPath(cliEntrypoint);
  const npmBinDir = findNpmBinDir(dirname(externalCliEntrypoint));
  if (npmBinDir) {
    return npmBinDir;
  }

  // The resolved entrypoint can be a phantom path (e.g. packaged builds where the
  // CLI is not unpacked next to `require.resolve`'s result and the shim ships on
  // PATH instead). Don't prepend a non-existent dir to PATH.
  const fallbackDir = dirname(externalCliEntrypoint);
  return existsSync(fallbackDir) ? fallbackDir : null;
}

export function resolvePaseoCliExecutablePath(): string | null {
  const cliEntrypoint = resolvePaseoCliBinEntrypoint();
  if (!cliEntrypoint) {
    return null;
  }

  const externalCliEntrypoint = resolveExternalProcessPath(cliEntrypoint);
  const npmBinDir = findNpmBinDir(dirname(externalCliEntrypoint));
  if (npmBinDir) {
    const shim = resolvePaseoCliShim(npmBinDir);
    if (shim) {
      return shim;
    }
  }

  // When the CLI isn't unpacked next to the resolved entrypoint, don't hand the
  // shell a phantom path — returning null lets the agent hooks fall back to
  // `${PASEO_HOOK_CLI:-paseo}`, resolving `paseo` from PATH instead.
  return existsSync(externalCliEntrypoint) ? externalCliEntrypoint : null;
}

function resolvePaseoCliBinEntrypoint(): string | null {
  try {
    return require.resolve(PASEO_CLI_BIN_ENTRY);
  } catch {
    return null;
  }
}

function findNpmBinDir(startPath: string): string | null {
  let current = startPath;
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (hasPaseoCliShim(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasPaseoCliShim(binDir: string): boolean {
  return resolvePaseoCliShim(binDir) !== null;
}

function resolvePaseoCliShim(binDir: string): string | null {
  for (const name of paseoCliShimNames()) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function paseoCliShimNames(): string[] {
  return process.platform === "win32" ? ["paseo.cmd", "paseo.exe", "paseo"] : ["paseo"];
}

function resolveZshShellIntegrationRuntimeDir(): string {
  let username = "unknown";
  try {
    username = userInfo().username || username;
  } catch {
    // keep fallback
  }
  return join(tmpdir(), `${username}-paseo-zsh`);
}

function prepareZshShellIntegrationRuntimeDir(sourceDir = resolveZshShellIntegrationDir()): string {
  const readableSourceDir = resolveExternalProcessPath(sourceDir);
  const runtimeDir = resolveZshShellIntegrationRuntimeDir();
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  chmodSync(runtimeDir, 0o700);
  writePrivateFileAtomicSync(
    join(runtimeDir, ".zshenv"),
    readFileSync(join(readableSourceDir, ".zshenv")),
  );
  writePrivateFileAtomicSync(
    join(runtimeDir, "paseo-integration.zsh"),
    readFileSync(join(readableSourceDir, "paseo-integration.zsh")),
  );
  return runtimeDir;
}

export function buildTerminalEnvironment(
  input: BuildTerminalEnvironmentInput,
): Record<string, string> {
  const baseEnv: Record<string, string> = createExternalProcessEnv(process.env, input.env, {
    TERM: "xterm-256color",
    TERM_PROGRAM: "kitty",
  });
  const envWithAgentHooks = prependPaseoCliToPath(
    baseEnv,
    input.paseoCliBinDir === undefined ? resolvePaseoCliBinDir() : input.paseoCliBinDir,
  );
  const envWithHookCli = injectPaseoHookCli(
    envWithAgentHooks,
    input.paseoHookCliPath === undefined ? resolvePaseoCliExecutablePath() : input.paseoHookCliPath,
  );

  if (basename(input.shell) !== "zsh") {
    return envWithHookCli;
  }

  const originalZdotdir = envWithHookCli.ZDOTDIR ?? "";
  return {
    ...envWithHookCli,
    PASEO_ZSH_ZDOTDIR: originalZdotdir,
    ZDOTDIR: prepareZshShellIntegrationRuntimeDir(input.zshShellIntegrationDir),
  };
}

function injectPaseoHookCli(
  env: Record<string, string>,
  cliPath: string | null,
): Record<string, string> {
  if (!cliPath) {
    return env;
  }

  return {
    ...env,
    PASEO_HOOK_CLI: resolvePath(resolveExternalProcessPath(cliPath)),
  };
}

function prependPaseoCliToPath(
  env: Record<string, string>,
  cliBinDir: string | null,
): Record<string, string> {
  if (!cliBinDir) {
    return env;
  }

  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] ?? "";
  return {
    ...env,
    [pathKey]: prependPathEntry(currentPath, cliBinDir),
  };
}

function getPathEnvKey(env: Record<string, string>): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function prependPathEntry(currentPath: string, entry: string): string {
  const entries = currentPath.split(delimiter).filter((value) => value && value !== entry);
  return [entry, ...entries].join(delimiter);
}

function extractCell(terminal: TerminalType, row: number, col: number): TerminalCell {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(row);
  if (!line) {
    return { char: " ", fg: undefined, bg: undefined };
  }

  const cell = line.getCell(col);
  if (!cell) {
    return { char: " ", fg: undefined, bg: undefined };
  }

  // Color modes from xterm.js: 0=DEFAULT, 1=16 colors (ANSI), 2=256 colors, 3=RGB
  // getFgColorMode() returns packed value with mode in upper byte (e.g. 0x01000000 for mode 1)
  const fgModeRaw = cell.getFgColorMode();
  const bgModeRaw = cell.getBgColorMode();
  const fgMode = fgModeRaw >> 24;
  const bgMode = bgModeRaw >> 24;

  // Only return color if not default (mode 0)
  const fg = fgMode !== 0 ? cell.getFgColor() : undefined;
  const bg = bgMode !== 0 ? cell.getBgColor() : undefined;

  return {
    char: cell.getChars() || " ",
    fg,
    bg,
    fgMode: fgMode !== 0 ? fgMode : undefined,
    bgMode: bgMode !== 0 ? bgMode : undefined,
    bold: cell.isBold() !== 0,
    italic: cell.isItalic() !== 0,
    underline: cell.isUnderline() !== 0,
    dim: cell.isDim() !== 0,
    inverse: cell.isInverse() !== 0,
    strikethrough: cell.isStrikethrough() !== 0,
  };
}

function extractGrid(terminal: TerminalType): TerminalCell[][] {
  const grid: TerminalCell[][] = [];
  const buffer = terminal.buffer.active;
  // Visible viewport starts at baseY
  const baseY = buffer.baseY;

  for (let row = 0; row < terminal.rows; row++) {
    const rowCells: TerminalCell[] = [];
    for (let col = 0; col < terminal.cols; col++) {
      rowCells.push(extractCell(terminal, baseY + row, col));
    }
    grid.push(rowCells);
  }

  return grid;
}

function extractScrollback(
  terminal: TerminalType,
  options?: { scrollbackLines?: number },
): TerminalCell[][] {
  const scrollback: TerminalCell[][] = [];
  const buffer = terminal.buffer.active;
  // baseY is the first row of the visible viewport (0-indexed)
  // Lines 0 to baseY-1 are in scrollback, lines baseY onwards are visible
  const scrollbackLines = buffer.baseY;
  const startRow =
    typeof options?.scrollbackLines === "number"
      ? Math.max(0, scrollbackLines - options.scrollbackLines)
      : 0;

  for (let row = startRow; row < scrollbackLines; row++) {
    const rowCells: TerminalCell[] = [];
    const line = buffer.getLine(row);
    for (let col = 0; col < terminal.cols; col++) {
      if (line) {
        const cell = line.getCell(col);
        if (cell) {
          const fgModeRaw = cell.getFgColorMode();
          const bgModeRaw = cell.getBgColorMode();
          const fgMode = fgModeRaw >> 24;
          const bgMode = bgModeRaw >> 24;
          const fg = fgMode !== 0 ? cell.getFgColor() : undefined;
          const bg = bgMode !== 0 ? cell.getBgColor() : undefined;
          rowCells.push({
            char: cell.getChars() || " ",
            fg,
            bg,
            fgMode: fgMode !== 0 ? fgMode : undefined,
            bgMode: bgMode !== 0 ? bgMode : undefined,
            bold: cell.isBold() !== 0,
            italic: cell.isItalic() !== 0,
            underline: cell.isUnderline() !== 0,
            dim: cell.isDim() !== 0,
            inverse: cell.isInverse() !== 0,
            strikethrough: cell.isStrikethrough() !== 0,
          });
        } else {
          rowCells.push({ char: " ", fg: undefined, bg: undefined });
        }
      } else {
        rowCells.push({ char: " ", fg: undefined, bg: undefined });
      }
    }
    scrollback.push(rowCells);
  }

  return scrollback;
}

// xterm marks a line `isWrapped` when it is a continuation of the PREVIOUS line.
// The snapshot carries the inverse, tmux-style flag — "this row continues onto the
// next row" — so the client can rejoin and reflow logical lines. So row y's flag is
// whether line y+1 is a wrapped continuation.
function lineContinuesToNext(terminal: TerminalType, absoluteRow: number): boolean {
  return terminal.buffer.active.getLine(absoluteRow + 1)?.isWrapped === true;
}

function extractGridWrapped(terminal: TerminalType): boolean[] {
  const baseY = terminal.buffer.active.baseY;
  const wrapped: boolean[] = [];
  for (let row = 0; row < terminal.rows; row++) {
    wrapped.push(lineContinuesToNext(terminal, baseY + row));
  }
  return wrapped;
}

function extractScrollbackWrapped(
  terminal: TerminalType,
  options?: { scrollbackLines?: number },
): boolean[] {
  const scrollbackLines = terminal.buffer.active.baseY;
  const startRow =
    typeof options?.scrollbackLines === "number"
      ? Math.max(0, scrollbackLines - options.scrollbackLines)
      : 0;
  const wrapped: boolean[] = [];
  for (let row = startRow; row < scrollbackLines; row++) {
    wrapped.push(lineContinuesToNext(terminal, row));
  }
  return wrapped;
}

function extractCursorState(terminal: TerminalType): TerminalState["cursor"] {
  const coreService = (terminal as unknown as { _core?: { coreService?: Record<string, unknown> } })
    ._core?.coreService as
    | {
        decPrivateModes?: { cursorStyle?: unknown; cursorBlink?: unknown };
        isCursorHidden?: unknown;
      }
    | undefined;
  const cursorStyle = coreService?.decPrivateModes?.cursorStyle;
  const normalizedCursorStyle =
    cursorStyle === "block" || cursorStyle === "underline" || cursorStyle === "bar"
      ? cursorStyle
      : undefined;
  const cursorBlink =
    typeof coreService?.decPrivateModes?.cursorBlink === "boolean"
      ? coreService.decPrivateModes.cursorBlink
      : undefined;
  const hidden = Boolean(coreService?.isCursorHidden);

  return {
    row: terminal.buffer.active.cursorY,
    col: terminal.buffer.active.cursorX,
    ...(hidden ? { hidden: true } : {}),
    ...(normalizedCursorStyle ? { style: normalizedCursorStyle } : {}),
    ...(typeof cursorBlink === "boolean" ? { blink: cursorBlink } : {}),
  };
}

function normalizeProcessToken(token: string): string {
  if (token.length === 0) {
    return token;
  }

  let quote: "'" | '"' | "";
  if (token.startsWith('"') && token.endsWith('"')) {
    quote = '"';
  } else if (token.startsWith("'") && token.endsWith("'")) {
    quote = "'";
  } else {
    quote = "";
  }
  const rawToken = quote ? token.slice(1, -1) : token;
  if (rawToken.length === 0) {
    return token;
  }

  const assignmentMatch = rawToken.match(/^([A-Za-z_][A-Za-z0-9_]*=)(.+)$/);
  const prefix = assignmentMatch ? assignmentMatch[1] : "";
  const value = assignmentMatch ? assignmentMatch[2] : rawToken;
  if (!value.includes("/")) {
    return token;
  }

  const normalized = `${prefix}${basename(value)}`;
  return quote ? `${quote}${normalized}${quote}` : normalized;
}

export function normalizeProcessTitle(processTitle: string): string | undefined {
  const trimmed = processTitle.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return undefined;
  }

  const normalized = trimmed
    .split(" ")
    .map((token) => normalizeProcessToken(token))
    .join(" ")
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

const PROCESS_INTERPRETERS = new Set([
  "bash",
  "bun",
  "deno",
  "node",
  "nodejs",
  "python",
  "python3",
  "ruby",
  "sh",
  "tsx",
  "zsh",
]);

const PACKAGE_MANAGER_SCRIPT_NAMES = new Map<string, string>([
  ["bun.js", "bun"],
  ["npm-cli.js", "npm"],
  ["npx-cli.js", "npx"],
  ["pnpm.cjs", "pnpm"],
  ["pnpm.js", "pnpm"],
  ["yarn.cjs", "yarn"],
  ["yarn.js", "yarn"],
]);

export function humanizeProcessTitle(processTitle: string): string | undefined {
  const normalized = normalizeProcessTitle(processTitle);
  if (!normalized) {
    return undefined;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }

  while (tokens[0] === "env") {
    tokens.shift();
    while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
    }
  }

  if (tokens.length === 0) {
    return normalized;
  }

  const first = tokens[0];
  const second = tokens[1];
  if (PROCESS_INTERPRETERS.has(first) && second) {
    const packageManager = PACKAGE_MANAGER_SCRIPT_NAMES.get(second);
    if (packageManager) {
      return [packageManager, ...tokens.slice(2)].join(" ").trim() || packageManager;
    }

    if (!second.startsWith("-")) {
      return [second, ...tokens.slice(2)].join(" ").trim();
    }
  }

  return normalized;
}

function extractLastOutputLines(terminal: TerminalType, limit: number): string[] {
  const buffer = terminal.buffer.active;
  const mergedLines: string[] = [];

  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }

    const text = line.translateToString(true);
    const isWrapped = (line as { isWrapped?: boolean }).isWrapped === true;
    if (isWrapped && mergedLines.length > 0) {
      mergedLines[mergedLines.length - 1] += text;
      continue;
    }
    mergedLines.push(text);
  }

  while (mergedLines.length > 0 && mergedLines[0]?.trim().length === 0) {
    mergedLines.shift();
  }
  while (mergedLines.length > 0 && mergedLines[mergedLines.length - 1]?.trim().length === 0) {
    mergedLines.pop();
  }

  return mergedLines.slice(-limit);
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_SEQUENCE_PATTERN = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\].*?(?:${BEL}|${ESC}\\\\))`,
  "g",
);

function stripAnsiSequences(input: string): string {
  return input.replace(ANSI_SEQUENCE_PATTERN, "");
}

function extractLastOutputLinesFromText(text: string, limit: number): string[] {
  const normalized = stripAnsiSequences(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.trimEnd());
  while (lines[0]?.trim().length === 0) {
    lines.shift();
  }
  while (lines[lines.length - 1]?.trim().length === 0) {
    lines.pop();
  }
  return lines.slice(-limit);
}

interface CreatePtyBackendInput {
  command?: string;
  args: string[];
  shell?: string;
  windowsShell?: WindowsShellPreference;
  cwd: string;
  workspaceId: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  activityEnv: Record<string, string>;
}

// Default terminal backend: spawns a local pty process. Extracted from
// createTerminal so alternate transports (ssh2 shell channels) can implement
// TerminalBackend without touching the session pipeline.
async function createPtyBackend(input: CreatePtyBackendInput): Promise<TerminalBackend> {
  ensureNodePtySpawnHelperExecutableForCurrentPlatform();

  const { command: spawnCommand, args: spawnArgs } = input.command
    ? await resolveTerminalSpawnCommand(input.command, input.args)
    : await resolveDefaultShellSpawn({
        shell: input.shell,
        windowsShell: input.windowsShell,
        onWarn: (message) => console.warn(`[paseo-terminal] ${message}`),
      });
  const ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: buildTerminalEnvironment({
      shell: spawnCommand,
      env: {
        ...input.env,
        ...input.activityEnv,
        PASEO_WORKSPACE_ID: input.workspaceId,
      },
    }),
  });

  let processExited = false;
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: TerminalBackendExitEvent) => void) | null = null;
  ptyProcess.onData((data) => {
    dataListener?.(data);
  });
  ptyProcess.onExit((event) => {
    processExited = true;
    exitListener?.({
      exitCode: event.exitCode ?? null,
      signal: event.signal ?? null,
    });
  });

  return {
    write(data: string): void {
      ptyProcess.write(data);
    },
    resize(cols: number, rows: number): void {
      ptyProcess.resize(cols, rows);
    },
    kill(signal?: NodeJS.Signals): void {
      if (process.platform === "win32") {
        ptyProcess.kill();
        return;
      }
      ptyProcess.kill(signal);
    },
    onData(listener: (data: string) => void): void {
      dataListener = listener;
    },
    onExit(listener: (event: TerminalBackendExitEvent) => void): void {
      exitListener = listener;
    },
    async waitForStart(): Promise<void> {
      // ConPTY starts the process asynchronously; wait for a real pid on
      // Windows so early input isn't dropped. POSIX ptys are ready at spawn.
      if (process.platform !== "win32") {
        return;
      }
      const started = (): boolean => {
        const windowsPtyProcess = ptyProcess as unknown as WindowsPtyProcessReadiness;
        return ptyProcess.pid > 0 || (windowsPtyProcess._agent?.innerPid ?? 0) > 0 || processExited;
      };
      const deadline = Date.now() + 5000;
      while (!started() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

interface ResolveTerminalBackendContext {
  command?: string;
  args: string[];
  shell?: string;
  cwd: string;
  workspaceId: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  activityEnv: Record<string, string>;
}

// Uses a caller-provided backend when present, else spawns the default pty
// backend. Kept separate so createTerminal stays within its complexity budget.
function resolveTerminalBackend(
  options: CreateTerminalOptions,
  context: ResolveTerminalBackendContext,
): Promise<TerminalBackend> {
  if (options.backend) {
    return Promise.resolve(options.backend);
  }
  return createPtyBackend({
    ...(context.command !== undefined ? { command: context.command } : {}),
    args: context.args,
    ...(context.shell !== undefined ? { shell: context.shell } : {}),
    ...(options.windowsShell !== undefined ? { windowsShell: options.windowsShell } : {}),
    cwd: context.cwd,
    workspaceId: context.workspaceId,
    cols: context.cols,
    rows: context.rows,
    env: context.env,
    activityEnv: context.activityEnv,
  });
}

export async function createTerminal(options: CreateTerminalOptions): Promise<TerminalSession> {
  const {
    cwd,
    workspaceId,
    shell,
    env = {},
    activityEnv = {},
    rows = 24,
    cols = 80,
    name = "Terminal",
    title: presetTitle,
    command,
    args = [],
  } = options;

  const id = options.id ?? randomUUID();
  const listeners = new Set<(msg: ServerMessage) => void>();
  const exitListeners = new Set<(info: TerminalExitInfo) => void>();
  const commandFinishedListeners = new Set<(info: TerminalCommandFinishedInfo) => void>();
  const titleChangeListeners = new Set<(title?: string) => void>();
  let killed = false;
  let disposed = false;
  let exitEmitted = false;
  let processExited = false;
  const processExitWaiters = new Set<() => void>();
  let exitInfo: TerminalExitInfo | null = null;
  // Recent output is retained as whole chunks plus a running char length so we
  // avoid reallocating a ~16KB string on every pty chunk. We keep enough whole
  // chunks that their join always contains at least the last
  // TERMINAL_EXIT_OUTPUT_CHAR_LIMIT chars; the exact tail is sliced at exit.
  const recentOutputChunks: string[] = [];
  let recentOutputLength = 0;
  let title: string | undefined;
  let titleMode = resolveInitialTitleMode(presetTitle);
  let pendingTitle: string | undefined;
  let titleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingInput = "";
  let inputFlushImmediate: ReturnType<typeof setImmediate> | null = null;
  let stateRevision = 0;
  const inputModeTracker = new TerminalInputModeTracker();
  const activityTracker = new TerminalActivityTracker();
  const activityChangeListeners = new Set<(transition: TerminalActivityTransition) => void>();
  let titleChangeSubscription: { dispose(): void } | null = null;

  // User input marks the terminal "working" for a short window. Agent hooks
  // are the only other activity source and never fire for plain shells or SSH
  // sessions, which would otherwise sit permanently at unknown. The decay uses
  // clear() (back to unknown, no dot) — set("idle") would flip a working
  // terminal into the "finished" attention state.
  const INPUT_ACTIVITY_DECAY_MS = 10_000;
  let inputActivityDecayTimer: NodeJS.Timeout | null = null;

  function armInputActivityDecay(expectedChangedAt: number): void {
    if (inputActivityDecayTimer) {
      clearTimeout(inputActivityDecayTimer);
    }
    inputActivityDecayTimer = setTimeout(() => {
      inputActivityDecayTimer = null;
      const current = activityTracker.getSnapshot();
      // Only downgrade the exact state this input marked; any later
      // hook-reported transition moved changedAt and wins.
      if (current.state === "working" && current.changedAt === expectedChangedAt) {
        activityTracker.clear();
      }
    }, INPUT_ACTIVITY_DECAY_MS);
    inputActivityDecayTimer.unref?.();
  }

  function markInputActivity(): void {
    const before = activityTracker.getSnapshot();
    activityTracker.set("working");
    const after = activityTracker.getSnapshot();
    const transitioned = after.changedAt !== before.changedAt;
    // Refresh the decay window when this input owns the working state — it
    // just transitioned it, or an earlier input mark armed the timer. A
    // hook-owned "working" (no transition, no timer) is left alone.
    if (transitioned || inputActivityDecayTimer) {
      armInputActivityDecay(after.changedAt);
    }
  }

  // Create xterm.js headless terminal
  const terminal = new Terminal({
    rows,
    cols,
    scrollback: 1000,
    allowProposedApi: true,
  });

  // Create the byte transport — a local pty by default, or a caller-provided
  // backend (e.g. an ssh2 shell channel).
  const backend = await resolveTerminalBackend(options, {
    command,
    args,
    shell,
    cwd,
    workspaceId,
    cols,
    rows,
    env,
    activityEnv,
  });

  function emitTitleChange(nextTitle: string | undefined): void {
    if (title === nextTitle) {
      return;
    }
    title = nextTitle;
    for (const listener of Array.from(titleChangeListeners)) {
      try {
        listener(title);
      } catch {
        // no-op
      }
    }
    for (const listener of Array.from(listeners)) {
      try {
        listener({ type: "titleChange", title });
      } catch {
        // no-op
      }
    }
  }

  function clearPendingTitleChange(): void {
    pendingTitle = undefined;
    if (titleDebounceTimer) {
      clearTimeout(titleDebounceTimer);
      titleDebounceTimer = null;
    }
  }

  function disposeTitleChangeSubscription(): void {
    titleChangeSubscription?.dispose();
    titleChangeSubscription = null;
  }

  function setTitle(nextTitle: string): void {
    const manualTitle = nextTitle.trim();
    if (!manualTitle) {
      return;
    }

    titleMode = "manual";
    disposeTitleChangeSubscription();
    clearPendingTitleChange();
    emitTitleChange(manualTitle);
  }

  const initialManualTitle = presetTitle?.trim() || undefined;
  const processTitle = command ? [command, ...args].join(" ") : null;
  let initialTitle = initialManualTitle;
  if (!initialTitle && processTitle) {
    initialTitle = humanizeProcessTitle(processTitle) ?? normalizeProcessTitle(processTitle);
  }
  emitTitleChange(initialTitle);

  // Respond to DA1 queries (CSI c or CSI 0 c) — apps like nvim query terminal capabilities
  terminal.parser.registerCsiHandler({ final: "c" }, (params) => {
    if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
      backend.write("\x1b[?62;4;22c");
      return true;
    }
    return false;
  });
  terminal.parser.registerCsiHandler({ final: "n" }, (params) => {
    if (params.length !== 1) {
      return false;
    }
    if (params[0] === 5) {
      backend.write("\x1b[0n");
      return true;
    }
    if (params[0] === 6) {
      const buffer = terminal.buffer.active;
      backend.write(`\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}R`);
      return true;
    }
    return false;
  });
  terminal.parser.registerCsiHandler({ prefix: "?", final: "n" }, (params) => {
    if (params.length !== 1 || params[0] !== 6) {
      return false;
    }
    const buffer = terminal.buffer.active;
    backend.write(`\x1b[?${buffer.cursorY + 1};${buffer.cursorX + 1}R`);
    return true;
  });
  for (const [code, response] of TERMINAL_OSC_COLOR_QUERY_RESPONSES) {
    terminal.parser.registerOscHandler(code, (data) => {
      if (data.trim() !== "?") {
        return false;
      }
      backend.write(`\x1b]${code};${response}\x1b\\`);
      return true;
    });
  }

  if (titleMode === "auto") {
    titleChangeSubscription = terminal.onTitleChange((nextTitle) => {
      if (disposed || killed) {
        return;
      }
      pendingTitle = nextTitle.trim().length > 0 ? nextTitle : undefined;
      if (titleDebounceTimer) {
        clearTimeout(titleDebounceTimer);
      }
      titleDebounceTimer = setTimeout(() => {
        titleDebounceTimer = null;
        emitTitleChange(pendingTitle);
        pendingTitle = undefined;
      }, TERMINAL_TITLE_DEBOUNCE_MS);
    });
  }

  const disposeCommandLifecycleSubscription = terminal.parser.registerOscHandler(633, (data) => {
    const commandFinished = parseCommandFinishedOsc(data);
    if (!commandFinished) {
      return true;
    }

    for (const listener of Array.from(commandFinishedListeners)) {
      try {
        listener(commandFinished);
      } catch {
        // no-op
      }
    }
    return true;
  });

  activityTracker.onChange((snapshot, previousSnapshot) => {
    if (disposed || killed) {
      return;
    }
    const transition: TerminalActivityTransition = {
      activity: toTerminalActivity(snapshot),
      previous: toTerminalActivity(previousSnapshot),
    };
    for (const listener of Array.from(activityChangeListeners)) {
      try {
        listener(transition);
      } catch {
        // no-op
      }
    }
  });

  function buildExitInfo(input?: {
    exitCode?: number | null;
    signal?: number | null;
  }): TerminalExitInfo {
    const lastOutputLines = extractLastOutputLines(terminal, TERMINAL_EXIT_OUTPUT_LINE_LIMIT);
    return {
      exitCode: input?.exitCode ?? null,
      signal: input?.signal && input.signal > 0 ? input.signal : null,
      lastOutputLines:
        lastOutputLines.length > 0
          ? lastOutputLines
          : extractLastOutputLinesFromText(
              recentOutputChunks.join("").slice(-TERMINAL_EXIT_OUTPUT_CHAR_LIMIT),
              TERMINAL_EXIT_OUTPUT_LINE_LIMIT,
            ),
    };
  }

  function emitExit(info: TerminalExitInfo): void {
    if (exitEmitted) {
      return;
    }
    exitEmitted = true;
    exitInfo = info;
    for (const listener of Array.from(exitListeners)) {
      try {
        listener(info);
      } catch {
        // no-op
      }
    }
    exitListeners.clear();
  }

  function disposeResources(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    activityTracker.clear();
    pendingInput = "";
    recentOutputChunks.length = 0;
    recentOutputLength = 0;
    inputModeTracker.reset();
    if (inputFlushImmediate) {
      clearImmediate(inputFlushImmediate);
      inputFlushImmediate = null;
    }
    clearPendingTitleChange();
    disposeTitleChangeSubscription();
    disposeCommandLifecycleSubscription.dispose();
    if (inputActivityDecayTimer) {
      clearTimeout(inputActivityDecayTimer);
      inputActivityDecayTimer = null;
    }
    activityTracker.dispose();
    terminal.dispose();
    listeners.clear();
    exitListeners.clear();
    commandFinishedListeners.clear();
    titleChangeListeners.clear();
    activityChangeListeners.clear();
  }

  function writeOutputToHeadless(data: string): void {
    terminal.write(data, () => {
      if (disposed || killed) {
        return;
      }
      stateRevision += 1;
      for (const listener of listeners) {
        listener({ type: "output", data, revision: stateRevision });
      }
    });
  }

  // Pipe backend output to terminal emulator
  backend.onData((data) => {
    if (killed) return;
    const inputModeUpdate = inputModeTracker.feed(data);
    for (const response of inputModeUpdate.responses) {
      backend.write(response);
    }
    recentOutputChunks.push(data);
    recentOutputLength += data.length;
    // Drop whole leading chunks while the rest still covers the char limit, so
    // the retained join always contains at least the last limit chars.
    while (
      recentOutputChunks.length > 1 &&
      recentOutputLength - recentOutputChunks[0].length >= TERMINAL_EXIT_OUTPUT_CHAR_LIMIT
    ) {
      recentOutputLength -= recentOutputChunks[0].length;
      recentOutputChunks.shift();
    }
    // We never drop the last chunk, so a single chunk larger than the cap would
    // grow the buffer unbounded; slice its tail to keep the cap hard.
    if (recentOutputChunks.length === 1 && recentOutputLength > TERMINAL_EXIT_OUTPUT_CHAR_LIMIT) {
      const tail = recentOutputChunks[0].slice(-TERMINAL_EXIT_OUTPUT_CHAR_LIMIT);
      recentOutputChunks[0] = tail;
      recentOutputLength = tail.length;
    }
    writeOutputToHeadless(data);
  });

  backend.onExit((event) => {
    killed = true;
    processExited = true;
    for (const waiter of Array.from(processExitWaiters)) {
      try {
        waiter();
      } catch {
        // no-op
      }
    }
    processExitWaiters.clear();
    emitExit(
      buildExitInfo({
        exitCode: event.exitCode,
        signal: event.signal,
      }),
    );
    disposeResources();
  });

  function getState(snapshotOptions?: TerminalStateSnapshotOptions): TerminalState {
    return {
      rows: terminal.rows,
      cols: terminal.cols,
      grid: extractGrid(terminal),
      scrollback: extractScrollback(terminal, {
        scrollbackLines: snapshotOptions?.scrollbackLines,
      }),
      cursor: extractCursorState(terminal),
      ...(title ? { title } : {}),
      ...(snapshotOptions?.includeWrapFlags
        ? {
            gridWrapped: extractGridWrapped(terminal),
            scrollbackWrapped: extractScrollbackWrapped(terminal, {
              scrollbackLines: snapshotOptions?.scrollbackLines,
            }),
          }
        : {}),
    };
  }

  function getStateSnapshot(snapshotOptions?: TerminalStateSnapshotOptions): TerminalStateSnapshot {
    return {
      state: getState(snapshotOptions),
      revision: stateRevision,
    };
  }

  function getSize(): { rows: number; cols: number } {
    return {
      rows: terminal.rows,
      cols: terminal.cols,
    };
  }

  function getReplayPreamble(): string {
    return inputModeTracker.getPreamble();
  }

  function writeInputToPty(data: string): void {
    backend.write(data);
  }

  function flushPendingInput(): void {
    if (inputFlushImmediate) {
      clearImmediate(inputFlushImmediate);
      inputFlushImmediate = null;
    }
    const data = pendingInput;
    pendingInput = "";
    if (!data || killed || disposed) {
      return;
    }
    writeInputToPty(data);
  }

  function scheduleInputFlush(): void {
    if (inputFlushImmediate) {
      return;
    }
    inputFlushImmediate = setImmediate(() => {
      inputFlushImmediate = null;
      flushPendingInput();
    });
  }

  function send(msg: ClientMessage): void {
    if (killed) return;

    switch (msg.type) {
      case "input": {
        pendingInput += msg.data;
        scheduleInputFlush();
        markInputActivity();
        break;
      }
      case "resize":
        flushPendingInput();
        terminal.resize(msg.cols, msg.rows);
        backend.resize(msg.cols, msg.rows);
        stateRevision += 1;
        break;
      case "mouse":
        // Mouse events can be sent as escape sequences if terminal supports it
        // For now, we'll just ignore them - can be implemented later
        break;
    }
  }

  function subscribe(
    listener: (msg: ServerMessage) => void,
    subscribeOptions?: TerminalSubscribeOptions,
  ): () => void {
    let active = true;
    let snapshotDelivered = false;
    const queuedMessages: ServerMessage[] = [];
    const initialSnapshot = subscribeOptions?.initialSnapshot ?? "state";
    const subscriptionListener = (msg: ServerMessage): void => {
      if (!active) {
        return;
      }
      if (!snapshotDelivered) {
        queuedMessages.push(msg);
        return;
      }
      listener(msg);
    };

    listeners.add(subscriptionListener);

    terminal.write("", () => {
      if (!disposed && active && listeners.has(subscriptionListener)) {
        snapshotDelivered = true;
        if (initialSnapshot === "ready") {
          // Carry the input-mode preamble so the snapshot-less "ready" path
          // (live restore) can replay it without a separate state fetch.
          listener({
            type: "snapshotReady",
            revision: stateRevision,
            replayPreamble: getReplayPreamble(),
          });
        } else {
          listener({ type: "snapshot", ...getStateSnapshot() });
        }
        for (const message of queuedMessages.splice(0)) {
          listener(message);
        }
      }
    });

    return () => {
      active = false;
      queuedMessages.length = 0;
      listeners.delete(subscriptionListener);
    };
  }

  function onExit(listener: (info: TerminalExitInfo) => void): () => void {
    if (killed) {
      queueMicrotask(() => {
        try {
          listener(exitInfo ?? buildExitInfo());
        } catch {
          // no-op
        }
      });
      return () => {};
    }

    exitListeners.add(listener);
    return () => {
      exitListeners.delete(listener);
    };
  }

  function onCommandFinished(listener: (info: TerminalCommandFinishedInfo) => void): () => void {
    commandFinishedListeners.add(listener);
    return () => {
      commandFinishedListeners.delete(listener);
    };
  }

  function onTitleChange(listener: (title?: string) => void): () => void {
    titleChangeListeners.add(listener);
    if (title !== undefined) {
      queueMicrotask(() => {
        if (disposed || !titleChangeListeners.has(listener)) {
          return;
        }
        try {
          listener(title);
        } catch {
          // no-op
        }
      });
    }
    return () => {
      titleChangeListeners.delete(listener);
    };
  }

  function onActivityChange(
    listener: (transition: TerminalActivityTransition) => void,
  ): () => void {
    activityChangeListeners.add(listener);
    return () => {
      activityChangeListeners.delete(listener);
    };
  }

  function getTitle(): string | undefined {
    return title;
  }

  function getActivity(): TerminalActivity | null {
    return toTerminalActivity(activityTracker.getSnapshot());
  }

  function setActivity(state: TerminalActivityState): void {
    activityTracker.set(state);
  }

  function clearActivityAttention(): boolean {
    return activityTracker.clearAttention();
  }

  function getExitInfo(): TerminalExitInfo | null {
    return exitInfo;
  }

  function kill(): void {
    if (!killed) {
      killed = true;
      if (!processExited) {
        killPtyProcess();
      }
      emitExit(buildExitInfo());
    }
    if (processExited) {
      disposeResources();
      return;
    }
    void waitForProcessExit(1000).finally(disposeResources);
  }

  function killPtyProcess(signal?: NodeJS.Signals): void {
    backend.kill(signal);
  }

  function waitForProcessExit(timeoutMs: number): Promise<boolean> {
    if (processExited) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let pendingResolve: ((value: boolean) => void) | null = resolve;
      const settle = (value: boolean) => {
        if (!pendingResolve) return;
        const fn = pendingResolve;
        pendingResolve = null;
        fn(value);
      };
      const waiter = (): void => {
        clearTimeout(timer);
        settle(true);
      };
      const timer = setTimeout(() => {
        processExitWaiters.delete(waiter);
        settle(false);
      }, timeoutMs);
      processExitWaiters.add(waiter);
    });
  }

  async function killAndWait(killOptions?: {
    gracefulTimeoutMs?: number;
    forceTimeoutMs?: number;
  }): Promise<void> {
    const gracefulTimeoutMs = killOptions?.gracefulTimeoutMs ?? 2000;
    const forceTimeoutMs = killOptions?.forceTimeoutMs ?? 1000;

    if (processExited) {
      kill();
      return;
    }

    try {
      killPtyProcess();
    } catch {
      // process may already be gone
    }

    const exitedGracefully = await waitForProcessExit(gracefulTimeoutMs);
    if (!exitedGracefully) {
      try {
        killPtyProcess("SIGKILL");
      } catch {
        // process may already be gone
      }
      await waitForProcessExit(forceTimeoutMs);
    }

    // Finalize bookkeeping (idempotent if backend.onExit already fired).
    kill();
  }

  await backend.waitForStart?.();

  // Small delay to let shell initialize
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    id,
    name,
    cwd,
    workspaceId,
    send,
    subscribe,
    onExit,
    onCommandFinished,
    onTitleChange,
    onActivityChange,
    getSize,
    getState,
    getStateSnapshot,
    getReplayPreamble,
    getTitle,
    getActivity,
    setActivity,
    clearActivityAttention,
    setTitle,
    getExitInfo,
    kill,
    killAndWait,
  };
}
