import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ScannedGitRepo } from "@getpaseo/protocol/messages";
import { runGitCommand } from "../utils/run-git-command.js";

const DEFAULT_MAX_DEPTH = 6;
const MAX_REPOS = 200;
const MAX_DIRECTORIES_VISITED = 50_000;
const GIT_QUERY_TIMEOUT_MS = 10_000;

const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

/**
 * Directories that are never descended into: dependency/build output trees
 * are both huge and never contain user-owned repositories.
 */
const SKIPPED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "bower_components",
  "Pods",
  "DerivedData",
  "__pycache__",
  ".venv",
  "venv",
]);

export interface ScanGitReposInput {
  rootPath: string;
  maxDepth?: number;
}

export interface ScanGitReposResult {
  repos: ScannedGitRepo[];
  truncated: boolean;
}

interface WalkState {
  repoPaths: string[];
  directoriesVisited: number;
  truncated: boolean;
}

function shouldDescendInto(name: string): boolean {
  // Hidden directories (.git internals, caches, IDE state) cannot hold
  // user-visible repositories worth offering in the workspace picker.
  if (name.startsWith(".")) return false;
  return !SKIPPED_DIRECTORY_NAMES.has(name);
}

async function hasGitEntry(directory: string): Promise<boolean> {
  try {
    // A `.git` directory marks a normal repo; a `.git` file marks a
    // submodule or linked worktree — both count as repositories here.
    await stat(join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function walkDirectory(
  directory: string,
  depthRemaining: number,
  state: WalkState,
): Promise<void> {
  if (state.repoPaths.length >= MAX_REPOS) {
    state.truncated = true;
    return;
  }
  if (state.directoriesVisited >= MAX_DIRECTORIES_VISITED) {
    state.truncated = true;
    return;
  }
  state.directoriesVisited += 1;

  if (await hasGitEntry(directory)) {
    state.repoPaths.push(directory);
    if (state.repoPaths.length >= MAX_REPOS) {
      state.truncated = true;
      return;
    }
  }

  if (depthRemaining <= 0) return;

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // Unreadable directories (permissions, races) are skipped silently.
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!shouldDescendInto(entry.name)) continue;
    await walkDirectory(join(directory, entry.name), depthRemaining - 1, state);
    if (state.truncated && state.repoPaths.length >= MAX_REPOS) return;
  }
}

async function readLocalBranches(repoPath: string): Promise<string[]> {
  try {
    const result = await runGitCommand(
      ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads/"],
      { cwd: repoPath, envOverlay: READ_ONLY_GIT_ENV, timeout: GIT_QUERY_TIMEOUT_MS },
    );
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const result = await runGitCommand(["branch", "--show-current"], {
      cwd: repoPath,
      envOverlay: READ_ONLY_GIT_ENV,
      timeout: GIT_QUERY_TIMEOUT_MS,
    });
    const branch = result.stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

async function readDefaultBranch(repoPath: string): Promise<string | null> {
  try {
    const result = await runGitCommand(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd: repoPath,
      envOverlay: READ_ONLY_GIT_ENV,
      timeout: GIT_QUERY_TIMEOUT_MS,
    });
    const ref = result.stdout.trim();
    if (!ref) return null;
    return ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  } catch {
    return null;
  }
}

async function describeRepo(rootPath: string, repoPath: string): Promise<ScannedGitRepo> {
  const [branches, currentBranch, defaultBranch] = await Promise.all([
    readLocalBranches(repoPath),
    readCurrentBranch(repoPath),
    readDefaultBranch(repoPath),
  ]);
  const relativePath = relative(rootPath, repoPath) || ".";
  return {
    path: repoPath,
    relativePath,
    currentBranch,
    branches,
    defaultBranch,
  };
}

/**
 * Recursively scans rootPath for git repositories — including sub-repos
 * nested arbitrarily deep inside other repositories — and reports each
 * repo's local branches. Results are ordered by relative path so the
 * scanned root (when itself a repo) comes first.
 */
export async function scanGitRepos(input: ScanGitReposInput): Promise<ScanGitReposResult> {
  const rootStat = await stat(input.rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`Not a directory: ${input.rootPath}`);
  }

  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const state: WalkState = { repoPaths: [], directoriesVisited: 0, truncated: false };
  await walkDirectory(input.rootPath, maxDepth, state);

  state.repoPaths.sort((a, b) => a.localeCompare(b));
  const repos = await Promise.all(
    state.repoPaths.map((repoPath) => describeRepo(input.rootPath, repoPath)),
  );
  return { repos, truncated: state.truncated };
}
