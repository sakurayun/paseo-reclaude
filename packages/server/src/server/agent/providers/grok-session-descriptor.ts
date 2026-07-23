import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  ImportableProviderSession,
  ListImportableSessionsOptions,
} from "../agent-sdk-types.js";
import { createRealpathAwarePathMatcher } from "../../../utils/path.js";

/**
 * Grok Build stores provider-native sessions under:
 *   `$GROK_HOME/sessions/<encoded-cwd>/<session-id>/summary.json`
 * where `<encoded-cwd>` is typically `encodeURIComponent(cwd)`. When the
 * encoded name would exceed 255 bytes, Grok uses a slug+hash directory and
 * writes the real path to a `.cwd` file inside that group.
 *
 * Grok ACP advertises `loadSession` but does not implement `session/list`
 * (sessionCapabilities is empty). Import discovery therefore reads the on-disk
 * index the same way Pi/OMP do for providers without a listing RPC.
 */

const GROK_HOME_DIR_NAME = ".grok";
const GROK_HOME_ENV = "GROK_HOME";
const SUMMARY_FILE = "summary.json";
const CWD_MARKER_FILE = ".cwd";
const IMPORT_CANDIDATE_OVERSCAN = 40;
const IMPORT_CANDIDATE_MIN = 400;
const PROMPT_PREVIEW_MAX = 160;

interface GrokSessionDescriptorOptions extends ListImportableSessionsOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Override the sessions root (tests). Defaults to `$GROK_HOME/sessions`. */
  sessionsDir?: string;
}

interface GrokSummaryInfo {
  id?: unknown;
  cwd?: unknown;
}

interface GrokSummaryJson {
  info?: GrokSummaryInfo | null;
  session_summary?: unknown;
  generated_title?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  last_active_at?: unknown;
  num_messages?: unknown;
  num_chat_messages?: unknown;
  current_model_id?: unknown;
  reasoning_effort?: unknown;
}

interface RankedSessionDir {
  dir: string;
  mtime: Date;
}

export interface GrokImportSessionConfig {
  model?: string;
  thinkingOptionId?: string;
}

export async function listGrokImportableSessions(
  options: GrokSessionDescriptorOptions = {},
): Promise<ImportableProviderSession[]> {
  const sessionsRoot = resolveGrokSessionsDir(options);
  const sessionDirs = await discoverSessionDirs(sessionsRoot, options.cwd);
  const matchesCwd = options.cwd ? createRealpathAwarePathMatcher(options.cwd) : null;
  const limit = options.limit ?? 20;
  const ranked = await rankSessionDirsByMtime(sessionDirs);
  const candidateLimit = Math.max(limit * IMPORT_CANDIDATE_OVERSCAN, IMPORT_CANDIDATE_MIN);
  const candidates = matchesCwd ? ranked : ranked.slice(0, candidateLimit);
  const sessions: ImportableProviderSession[] = [];

  for (const entry of candidates) {
    const session = await readGrokImportableSession(entry.dir);
    if (!session) continue;
    if (matchesCwd && !matchesCwd(session.cwd)) continue;
    sessions.push(session);
    if (sessions.length >= limit) {
      break;
    }
  }

  return sessions.sort(
    (left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
  );
}

/**
 * Resolve model / thinking overrides for a Grok native session id.
 * Looks under the cwd group first, then falls back to a full sessions scan.
 */
export async function readGrokImportSessionConfig(
  sessionId: string,
  options: { cwd?: string; homeDir?: string; env?: NodeJS.ProcessEnv; sessionsDir?: string } = {},
): Promise<GrokImportSessionConfig> {
  const sessionsRoot = resolveGrokSessionsDir(options);
  const summaryPath = await resolveSummaryPath(sessionsRoot, sessionId, options.cwd);
  if (!summaryPath) return {};
  const summary = await readSummaryJson(summaryPath);
  if (!summary) return {};
  return toGrokImportSessionConfig(summary);
}

export function resolveGrokHomeDir(options: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const configured = env[GROK_HOME_ENV]?.trim();
  if (configured) {
    return expandHomePath(configured, homeDir);
  }
  return path.join(homeDir, GROK_HOME_DIR_NAME);
}

export function encodeGrokSessionCwd(cwd: string): string {
  return encodeURIComponent(cwd);
}

function resolveGrokSessionsDir(options: GrokSessionDescriptorOptions): string {
  if (options.sessionsDir?.trim()) {
    return options.sessionsDir;
  }
  return path.join(resolveGrokHomeDir(options), "sessions");
}

async function discoverSessionDirs(
  sessionsRoot: string,
  cwd: string | undefined,
): Promise<string[]> {
  if (!cwd) {
    return listAllSessionDirs(sessionsRoot);
  }

  // Prefer the canonical encoded group, then any group whose decoded/.cwd path
  // is realpath-equivalent (symlink / trailing-slash variants).
  const matchesCwd = createRealpathAwarePathMatcher(cwd);
  const preferredName = encodeGrokSessionCwd(cwd);
  const preferred = await listSessionsInGroup(path.join(sessionsRoot, preferredName));

  let groups: Dirent[];
  try {
    groups = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return preferred;
  }

  const matching = await Promise.all(
    groups.map(async (group) => {
      if (!group.isDirectory() || group.name.startsWith(".")) return [] as string[];
      if (group.name === preferredName) return [] as string[];
      const groupDir = path.join(sessionsRoot, group.name);
      const groupCwd = await resolveGroupCwd(groupDir, group.name);
      if (!groupCwd || !matchesCwd(groupCwd)) return [] as string[];
      return listSessionsInGroup(groupDir);
    }),
  );

  return preferred.concat(matching.flat());
}

async function listAllSessionDirs(sessionsRoot: string): Promise<string[]> {
  let groups: Dirent[];
  try {
    groups = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    groups.map(async (group) => {
      if (!group.isDirectory() || group.name.startsWith(".")) return [] as string[];
      return listSessionsInGroup(path.join(sessionsRoot, group.name));
    }),
  );
  return nested.flat();
}

async function resolveGroupCwd(groupDir: string, groupName: string): Promise<string | null> {
  const fromMarker = await readGroupCwdMarker(groupDir);
  if (fromMarker) return fromMarker;
  try {
    const decoded = decodeURIComponent(groupName);
    return decoded.includes("/") || decoded.includes("\\") ? decoded : null;
  } catch {
    return null;
  }
}

async function listSessionsInGroup(groupDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(groupDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(groupDir, entry.name));
}

async function rankSessionDirsByMtime(dirs: string[]): Promise<RankedSessionDir[]> {
  const ranked = await Promise.all(
    dirs.map(async (dir) => {
      const mtime = await readDirActivityMtime(dir);
      return mtime ? { dir, mtime } : null;
    }),
  );
  return ranked
    .filter((entry): entry is RankedSessionDir => entry !== null)
    .sort((left, right) => right.mtime.getTime() - left.mtime.getTime());
}

async function readDirActivityMtime(dir: string): Promise<Date | null> {
  // Prefer summary.json mtime — it updates when Grok rewrites metadata.
  const summaryMtime = await readFileMtime(path.join(dir, SUMMARY_FILE));
  if (summaryMtime) return summaryMtime;
  return readFileMtime(dir);
}

async function readGrokImportableSession(dir: string): Promise<ImportableProviderSession | null> {
  const summary = await readSummaryJson(path.join(dir, SUMMARY_FILE));
  if (!summary) return null;

  const sessionId = asNonEmptyString(summary.info?.id) ?? path.basename(dir);
  const cwd = asNonEmptyString(summary.info?.cwd) ?? (await readGroupCwdMarker(path.dirname(dir)));
  if (!cwd) return null;

  // Drop empty scratch sessions so the import picker stays useful.
  const chatMessages = asNonNegativeInt(summary.num_chat_messages);
  const messages = asNonNegativeInt(summary.num_messages);
  if ((chatMessages !== null && chatMessages <= 0) || (messages !== null && messages <= 0)) {
    return null;
  }

  const summaryText = asNonEmptyString(summary.session_summary);
  const generatedTitle = asNonEmptyString(summary.generated_title);
  const preview = normalizePromptPreview(summaryText ?? generatedTitle);
  if (!preview) {
    // No recoverable user-facing content — treat as empty for import listing.
    return null;
  }

  const lastActivityAt =
    parseDate(summary.last_active_at) ??
    parseDate(summary.updated_at) ??
    parseDate(summary.created_at) ??
    (await readDirActivityMtime(dir)) ??
    new Date(0);

  return {
    providerHandleId: sessionId,
    cwd,
    title: normalizePromptPreview(generatedTitle ?? summaryText),
    firstPromptPreview: preview,
    lastPromptPreview: preview,
    lastActivityAt,
  };
}

async function resolveSummaryPath(
  sessionsRoot: string,
  sessionId: string,
  cwd: string | undefined,
): Promise<string | null> {
  if (cwd) {
    const direct = path.join(sessionsRoot, encodeGrokSessionCwd(cwd), sessionId, SUMMARY_FILE);
    if (await fileExists(direct)) return direct;
  }

  // Fall back to scanning group directories for the session id.
  let groups: Dirent[];
  try {
    groups = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, group.name, sessionId, SUMMARY_FILE);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function readSummaryJson(summaryPath: string): Promise<GrokSummaryJson | null> {
  try {
    const raw = await readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as GrokSummaryJson) : null;
  } catch {
    return null;
  }
}

function toGrokImportSessionConfig(summary: GrokSummaryJson): GrokImportSessionConfig {
  const model = asNonEmptyString(summary.current_model_id) ?? undefined;
  const thinkingOptionId = asNonEmptyString(summary.reasoning_effort) ?? undefined;
  return {
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  };
}

async function readGroupCwdMarker(groupDir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(groupDir, CWD_MARKER_FILE), "utf8");
    return asNonEmptyString(raw);
  } catch {
    // Fall back to decoding the group directory name when possible.
    try {
      const decoded = decodeURIComponent(path.basename(groupDir));
      return decoded.includes("/") || decoded.includes("\\") ? decoded : null;
    } catch {
      return null;
    }
  }
}

async function readFileMtime(filePath: string): Promise<Date | null> {
  try {
    return (await stat(filePath)).mtime;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function expandHomePath(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(homeDir, value);
}

function normalizePromptPreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/<\/?user_query>/giu, " ")
    .replace(/<\/?user_info>[\s\S]*?<\/user_info>/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > PROMPT_PREVIEW_MAX ? cleaned.slice(0, PROMPT_PREVIEW_MAX) : cleaned;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
