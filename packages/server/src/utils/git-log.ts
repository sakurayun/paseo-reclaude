import type { GitCommitFile, GitCommitFileStatus, GitLogCommit } from "@getpaseo/protocol/messages";
import { runGitCommand } from "./run-git-command.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const GIT_LOG_TIMEOUT_MS = 15_000;

const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/**
 * Fields are joined with the ASCII unit separator (0x1f) and records with NUL
 * (via `-z`) — neither byte can appear in commit subjects, so parsing stays
 * unambiguous without escaping.
 */
const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b";
const FIELD_SEPARATOR = "\u001f";
const RECORD_SEPARATOR = "\u0000";

export interface GetCheckoutLogInput {
  cwd: string;
  limit?: number;
  /** HEAD oid the first page resolved to; later pages pass it back so pagination stays stable. */
  anchor?: string;
  skip?: number;
}

export interface GetCheckoutLogResult {
  commits: GitLogCommit[];
  anchor: string | null;
  hasMore: boolean;
}

export function parseGitLogOutput(stdout: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    if (!record) continue;
    const fields = record.split(FIELD_SEPARATOR);
    if (fields.length < 8) continue;
    const [hash, parents, authorName, authorEmail, authorDate, refs, subject] = fields;
    // A pathological body containing 0x1f would split further; glue it back.
    const body = fields.slice(7).join(FIELD_SEPARATOR);
    if (!hash) continue;
    commits.push({
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      subject,
      body: body.trim(),
      authorName,
      authorEmail,
      authorDate,
      refs: refs
        ? refs
            .split(", ")
            .map((ref) => ref.trim())
            .filter(Boolean)
        : [],
    });
  }
  return commits;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

async function resolveHeadOid(cwd: string): Promise<string | null> {
  // Unborn HEAD (fresh repo with no commits) makes rev-parse fail; that is
  // a valid empty-history state, not an error.
  try {
    const result = await runGitCommand(["rev-parse", "--verify", "HEAD"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      timeout: GIT_LOG_TIMEOUT_MS,
    });
    const oid = result.stdout.trim();
    return oid.length > 0 ? oid : null;
  } catch {
    return null;
  }
}

const FILE_STATUS_BY_LETTER: Record<string, GitCommitFileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "unmerged",
};

/**
 * Parses `git diff --name-status -z` output: NUL-separated tokens of
 * status, [oldPath for R/C], path.
 */
export function parseNameStatusOutput(stdout: string): GitCommitFile[] {
  const tokens = stdout.split(RECORD_SEPARATOR).filter((token) => token.length > 0);
  const files: GitCommitFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const statusToken = tokens[i];
    const letter = statusToken[0];
    const status = FILE_STATUS_BY_LETTER[letter] ?? "unknown";
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[i + 1];
      const path = tokens[i + 2];
      if (path === undefined || oldPath === undefined) break;
      files.push({ path, oldPath, status });
      i += 3;
    } else {
      const path = tokens[i + 1];
      if (path === undefined) break;
      files.push({ path, oldPath: null, status });
      i += 2;
    }
  }
  return files;
}

export interface GetCommitFilesInput {
  cwd: string;
  hash: string;
}

/**
 * Lists files changed by a commit, diffed against its first parent — the same
 * view `git show` presents (merges show their first-parent diff, roots show
 * everything they introduced).
 */
export async function getCommitFiles(input: GetCommitFilesInput): Promise<GitCommitFile[]> {
  const hash = input.hash.trim();
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) {
    throw new Error(`Invalid commit hash: ${input.hash}`);
  }

  let hasParent = true;
  try {
    await runGitCommand(["rev-parse", "--verify", `${hash}^`], {
      cwd: input.cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      timeout: GIT_LOG_TIMEOUT_MS,
    });
  } catch {
    hasParent = false;
  }

  const args = hasParent
    ? ["diff", "--name-status", "-z", "-M", `${hash}^`, hash]
    : ["diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-z", "-M", hash];
  const result = await runGitCommand(args, {
    cwd: input.cwd,
    envOverlay: READ_ONLY_GIT_ENV,
    timeout: GIT_LOG_TIMEOUT_MS,
  });
  return parseNameStatusOutput(result.stdout);
}

/**
 * Reads a page of commit history in topological order (parents always after
 * children — the invariant the client's lane-graph layout relies on).
 */
export async function getCheckoutLog(input: GetCheckoutLogInput): Promise<GetCheckoutLogResult> {
  const limit = clampLimit(input.limit);
  const skip = Math.max(0, Math.floor(input.skip ?? 0));

  const anchor = input.anchor?.trim() || (await resolveHeadOid(input.cwd));
  if (!anchor) {
    return { commits: [], anchor: null, hasMore: false };
  }

  // Fetch one extra row to learn whether another page exists.
  const result = await runGitCommand(
    [
      "log",
      anchor,
      "--topo-order",
      `--skip=${skip}`,
      `--max-count=${limit + 1}`,
      "-z",
      `--pretty=format:${LOG_FORMAT}`,
    ],
    { cwd: input.cwd, envOverlay: READ_ONLY_GIT_ENV, timeout: GIT_LOG_TIMEOUT_MS },
  );

  const commits = parseGitLogOutput(result.stdout);
  const hasMore = commits.length > limit;
  return {
    commits: hasMore ? commits.slice(0, limit) : commits,
    anchor,
    hasMore,
  };
}
