import type { CheckoutGitOp } from "@getpaseo/protocol/messages";

/**
 * Planning layer for checkout.git_op.request: maps each whitelisted op to a
 * fixed git argv sequence. Clients never send raw argv — every parameter is
 * validated here before it can reach a git invocation.
 */

export interface GitOpInput {
  op: CheckoutGitOp;
  name?: string;
  url?: string;
  message?: string;
  addAll?: boolean;
  stashIndex?: number;
  paths?: string[];
}

export interface GitOpPlan {
  /** git argv lists to run sequentially in the checkout cwd. */
  commands: string[][];
  /** Label passed to notifyGitMutation for cache invalidation. */
  mutation: string;
}

export class GitOpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitOpValidationError";
  }
}

/**
 * Ref-ish names (branches, tags, remotes, merge targets). Slashes are allowed
 * ("origin/main", "feature/x"); anything that could be parsed as a git flag
 * or smuggle extra arguments is not.
 */
function requireRefName(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new GitOpValidationError(`${label} is required`);
  }
  if (trimmed.startsWith("-")) {
    throw new GitOpValidationError(`${label} must not start with "-"`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) {
    throw new GitOpValidationError(`${label} must not contain whitespace or control characters`);
  }
  if (trimmed.includes("..")) {
    throw new GitOpValidationError(`${label} must not contain ".."`);
  }
  return trimmed;
}

function requireRemoteUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new GitOpValidationError("Remote URL is required");
  }
  if (trimmed.startsWith("-")) {
    throw new GitOpValidationError('Remote URL must not start with "-"');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) {
    throw new GitOpValidationError("Remote URL must not contain whitespace or control characters");
  }
  return trimmed;
}

/**
 * Repo-relative pathspecs for the *-paths ops. Spaces are fine (argv arrays,
 * no shell), but flags, parent traversal, and absolute paths are not.
 */
export function requirePaths(paths: string[] | undefined): string[] {
  const cleaned = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (cleaned.length === 0) {
    throw new GitOpValidationError("At least one path is required");
  }
  for (const path of cleaned) {
    if (path.startsWith("-")) {
      throw new GitOpValidationError(`Path must not start with "-": ${path}`);
    }
    if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
      throw new GitOpValidationError(`Path must be repo-relative: ${path}`);
    }
    if (path.split(/[\\/]/).includes("..")) {
      throw new GitOpValidationError(`Path must not contain "..": ${path}`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(path)) {
      throw new GitOpValidationError(`Path must not contain control characters: ${path}`);
    }
  }
  return cleaned;
}

function requireStashRef(stashIndex: number | undefined): string {
  if (stashIndex === undefined || !Number.isInteger(stashIndex) || stashIndex < 0) {
    throw new GitOpValidationError("Stash index is required");
  }
  return `stash@{${stashIndex}}`;
}

/** Ops with no parameters map straight to fixed command sequences. */
const FIXED_OP_COMMANDS: Partial<Record<CheckoutGitOp, string[][]>> = {
  fetch: [["fetch"]],
  "fetch-prune": [["fetch", "--prune"]],
  "fetch-all": [["fetch", "--all"]],
  "pull-rebase": [["pull", "--rebase"]],
  "stage-all": [["add", "-A"]],
  "unstage-all": [["reset"]],
  // Destructive: drop tracked changes, then delete untracked files/dirs.
  "discard-all": [
    ["reset", "--hard", "HEAD"],
    ["clean", "-fd"],
  ],
  "undo-last-commit": [["reset", "--soft", "HEAD~1"]],
  "abort-rebase": [["rebase", "--abort"]],
  // HEAD avoids resolving the current branch name daemon-side.
  "publish-branch": [["push", "-u", "origin", "HEAD"]],
  stash: [["stash", "push"]],
  "stash-untracked": [["stash", "push", "--include-untracked"]],
  "stash-staged": [["stash", "push", "--staged"]],
  "stash-clear": [["stash", "clear"]],
  "push-tags": [["push", "--tags"]],
};

export function planGitOp(input: GitOpInput): GitOpPlan {
  const fixed = FIXED_OP_COMMANDS[input.op];
  if (fixed) {
    return { commands: fixed, mutation: input.op };
  }
  return planParameterizedOp(input);
}

function planParameterizedOp(input: GitOpInput): GitOpPlan {
  const { op } = input;
  switch (op) {
    case "commit-amend": {
      const message = input.message?.trim();
      const commit = ["commit", "--amend", ...(message ? ["-m", message] : ["--no-edit"])];
      return {
        commands: input.addAll ? [["add", "-A"], commit] : [commit],
        mutation: op,
      };
    }
    case "create-branch":
      return {
        commands: [["checkout", "-b", requireRefName(input.name, "Branch name")]],
        mutation: op,
      };
    case "delete-branch":
      return {
        commands: [["branch", "-D", requireRefName(input.name, "Branch name")]],
        mutation: op,
      };
    case "merge-ref":
      return { commands: [["merge", requireRefName(input.name, "Merge ref")]], mutation: op };
    case "rebase-ref":
      return { commands: [["rebase", requireRefName(input.name, "Rebase ref")]], mutation: op };
    case "remote-add":
      return {
        commands: [
          ["remote", "add", requireRefName(input.name, "Remote name"), requireRemoteUrl(input.url)],
        ],
        mutation: op,
      };
    case "remote-remove":
      return {
        commands: [["remote", "remove", requireRefName(input.name, "Remote name")]],
        mutation: op,
      };
    case "stash-apply":
      return { commands: [["stash", "apply", requireStashRef(input.stashIndex)]], mutation: op };
    case "stash-drop":
      return { commands: [["stash", "drop", requireStashRef(input.stashIndex)]], mutation: op };
    case "tag-create":
      return { commands: [["tag", requireRefName(input.name, "Tag name")]], mutation: op };
    case "tag-delete":
      return { commands: [["tag", "-d", requireRefName(input.name, "Tag name")]], mutation: op };
    case "tag-delete-remote":
      return {
        commands: [["push", "origin", `:refs/tags/${requireRefName(input.name, "Tag name")}`]],
        mutation: op,
      };
    default:
      return planPathsOp(input);
  }
}

/** Pathspec-based ops: a fixed argv prefix plus the validated path list. */
const PATHS_OP_PREFIX: Partial<Record<CheckoutGitOp, string[]>> = {
  "stage-paths": ["add", "--"],
  "unstage-paths": ["reset", "--"],
  // Tracked files only; untracked ones go through clean-paths instead.
  "discard-paths": ["checkout", "--"],
  // Deletes untracked files/directories. Destructive, confirmed in the UI.
  "clean-paths": ["clean", "-fd", "--"],
  "stash-paths": ["stash", "push", "--include-untracked", "--"],
  // Read-only: the combined patch is returned in the response output.
  "diff-paths": ["diff", "HEAD", "--"],
};

function planPathsOp(input: GitOpInput): GitOpPlan {
  const prefix = PATHS_OP_PREFIX[input.op];
  if (!prefix) {
    throw new GitOpValidationError(`Unsupported git op: ${input.op}`);
  }
  return { commands: [[...prefix, ...requirePaths(input.paths)]], mutation: input.op };
}

export interface GitRemote {
  name: string;
  url: string;
}

/** Parse `git remote -v` output into unique remotes (fetch URL wins). */
export function parseGitRemotes(output: string): GitRemote[] {
  const remotes = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const [, name, url, kind] = match;
    if (kind === "fetch" || !remotes.has(name)) {
      remotes.set(name, url);
    }
  }
  return Array.from(remotes.entries(), ([name, url]) => ({ name, url }));
}

export interface GitStatusFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

/**
 * Parse NUL-delimited `git status --porcelain=v1 -z` output. Rename entries
 * ("R " / "C ") carry the original path as an extra NUL token, which we skip —
 * the UI only needs the current path.
 */
export function parseGitStatusFiles(output: string): GitStatusFile[] {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: GitStatusFile[] = [];
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.length < 4 || token[2] !== " ") {
      continue;
    }
    const indexStatus = token[0];
    const worktreeStatus = token[1];
    files.push({ path: token.slice(3), indexStatus, worktreeStatus });
    if (indexStatus === "R" || indexStatus === "C") {
      skipNext = true;
    }
  }
  return files;
}

export interface GitNumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

/** Resolve numstat rename notation ("pre{a => b}post" or "old => new") to the new path. */
function resolveNumstatPath(raw: string): string {
  const braceMatch = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braceMatch) {
    const [, prefix, , to, suffix] = braceMatch;
    return `${prefix}${to}${suffix}`;
  }
  const arrowIndex = raw.indexOf(" => ");
  if (arrowIndex >= 0) {
    return raw.slice(arrowIndex + 4);
  }
  return raw;
}

/** Parse `git diff --numstat` output. Binary entries ("-") are skipped. */
export function parseGitNumstat(output: string): GitNumstatEntry[] {
  const entries: GitNumstatEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [added, deleted, ...rest] = trimmed.split("\t");
    if (rest.length === 0) continue;
    const additions = Number.parseInt(added, 10);
    const deletions = Number.parseInt(deleted, 10);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    entries.push({ path: resolveNumstatPath(rest.join("\t")), additions, deletions });
  }
  return entries;
}

/**
 * Count lines in a text buffer for untracked-file +N badges; returns null for
 * binary content (NUL byte found).
 */
export function countTextBufferLines(buffer: Buffer): number | null {
  if (buffer.length === 0) {
    return 0;
  }
  if (buffer.includes(0)) {
    return null;
  }
  let lines = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) {
      lines += 1;
    }
  }
  if (buffer[buffer.length - 1] !== 0x0a) {
    lines += 1;
  }
  return lines;
}

/** Parse `git tag --list` output into tag names. */
export function parseGitTags(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
