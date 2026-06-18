import path from "node:path";
import type { WorkspaceFileMatch } from "@getpaseo/protocol/messages";

const DEFAULT_MAX_RESULTS = 200;

export interface WorkspaceSearchTarget {
  workspaceId: string;
  root: string;
}

export interface WorkspaceFileSearchResult {
  results: WorkspaceFileMatch[];
  truncated: boolean;
  engine: "ripgrep" | "node-walk";
}

export interface WorkspaceFileSearchDeps {
  /** Resolve the ripgrep executable path, or null if it is not installed. */
  resolveRipgrep(): Promise<string | null>;
  /** Run ripgrep and return its raw stdout (one JSON object per line). */
  runRipgrep(input: { rgPath: string; args: string[]; cwd: string }): Promise<string>;
}

/**
 * Thrown when ripgrep is not installed. The daemon does not bundle ripgrep and we
 * do not silently degrade to a slow Node walk in this version — the client shows a
 * "ripgrep not available" message instead (a future node-walk fallback can set
 * engine: "node-walk").
 */
export class RipgrepUnavailableError extends Error {
  constructor() {
    super("ripgrep (rg) is not available on this host");
    this.name = "RipgrepUnavailableError";
  }
}

interface RipgrepSubmatch {
  match: { text: string };
  start: number;
  end: number;
}

interface RipgrepMatchData {
  path: { text?: string };
  lines: { text?: string };
  line_number: number;
  submatches: RipgrepSubmatch[];
}

function isRipgrepMatchLine(value: unknown): value is { type: "match"; data: RipgrepMatchData } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { type?: unknown; data?: unknown };
  if (record.type !== "match" || typeof record.data !== "object" || record.data === null) {
    return false;
  }
  const data = record.data as Record<string, unknown>;
  return (
    typeof data.line_number === "number" &&
    Array.isArray(data.submatches) &&
    typeof data.path === "object" &&
    data.path !== null &&
    typeof data.lines === "object" &&
    data.lines !== null
  );
}

/**
 * Parse ripgrep's `--json` stdout into workspace file matches. Non-match event
 * lines (begin/end/summary) and malformed lines are ignored.
 */
export function parseRipgrepMatches(
  stdout: string,
  workspaceId: string,
  root: string,
): WorkspaceFileMatch[] {
  const results: WorkspaceFileMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRipgrepMatchLine(parsed)) {
      continue;
    }
    const data = parsed.data;
    const relPath = data.path.text;
    if (!relPath) {
      continue;
    }
    const submatch = data.submatches[0];
    const lineText = (data.lines.text ?? "").replace(/\r?\n$/, "");
    results.push({
      workspaceId,
      absPath: path.isAbsolute(relPath) ? relPath : path.join(root, relPath),
      relPath,
      line: data.line_number,
      column: submatch ? submatch.start : 0,
      lineText,
      matchStart: submatch ? submatch.start : 0,
      matchEnd: submatch ? submatch.end : 0,
    });
  }
  return results;
}

/**
 * Search workspace files via ripgrep, which respects .gitignore and skips binary
 * files. Searches each target's root (cwd) recursively and aggregates matches up
 * to maxResults.
 */
export async function searchWorkspaceFiles(
  input: {
    targets: readonly WorkspaceSearchTarget[];
    query: string;
    maxResults?: number;
    caseSensitive?: boolean;
  },
  deps: WorkspaceFileSearchDeps,
): Promise<WorkspaceFileSearchResult> {
  if (!input.query) {
    return { results: [], truncated: false, engine: "ripgrep" };
  }
  const rgPath = await deps.resolveRipgrep();
  if (!rgPath) {
    throw new RipgrepUnavailableError();
  }
  const maxResults =
    input.maxResults && input.maxResults > 0 ? input.maxResults : DEFAULT_MAX_RESULTS;
  const results: WorkspaceFileMatch[] = [];
  let truncated = false;
  for (const target of input.targets) {
    if (results.length >= maxResults) {
      truncated = true;
      break;
    }
    const args = ["--json", ...(input.caseSensitive ? [] : ["--ignore-case"]), "--", input.query];
    const stdout = await deps.runRipgrep({ rgPath, args, cwd: target.root });
    for (const match of parseRipgrepMatches(stdout, target.workspaceId, target.root)) {
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
      results.push(match);
    }
  }
  return { results, truncated, engine: "ripgrep" };
}
