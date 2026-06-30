import { resolve } from "node:path";
import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import { scanGitRepos, type ScanGitReposInput, type ScanGitReposResult } from "./scan-git-repos.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

const DESCENDANT_REPO_SCAN_DEPTH = 3;

export type LocalCheckoutWorkspaceTargetReason = "input" | "single-descendant-git-repo";

export interface LocalCheckoutWorkspaceTarget {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
  reason: LocalCheckoutWorkspaceTargetReason;
}

export interface LocalCheckoutWorkspaceTargetDeps {
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout">;
  scanGitRepos?: (input: ScanGitReposInput) => Promise<ScanGitReposResult>;
}

export async function resolveLocalCheckoutWorkspaceTarget(
  cwd: string,
  deps: LocalCheckoutWorkspaceTargetDeps,
): Promise<LocalCheckoutWorkspaceTarget> {
  const normalizedCwd = resolve(cwd);
  const checkout = await deps.workspaceGitService.getCheckout(normalizedCwd);
  if (checkout.isGit) {
    return { cwd: normalizedCwd, checkout, reason: "input" };
  }

  const descendantRepoPath = await findSingleDescendantGitRepo(
    normalizedCwd,
    deps.scanGitRepos ?? scanGitRepos,
  );
  if (!descendantRepoPath) {
    return { cwd: normalizedCwd, checkout, reason: "input" };
  }

  const descendantCheckout = await deps.workspaceGitService.getCheckout(descendantRepoPath);
  if (!descendantCheckout.isGit) {
    return { cwd: normalizedCwd, checkout, reason: "input" };
  }

  return {
    cwd: descendantRepoPath,
    checkout: descendantCheckout,
    reason: "single-descendant-git-repo",
  };
}

async function findSingleDescendantGitRepo(
  cwd: string,
  scan: (input: ScanGitReposInput) => Promise<ScanGitReposResult>,
): Promise<string | null> {
  try {
    const result = await scan({ rootPath: cwd, maxDepth: DESCENDANT_REPO_SCAN_DEPTH });
    const descendantRepos = result.repos
      .map((repo) => resolve(repo.path))
      .filter((repoPath) => repoPath !== cwd);
    return descendantRepos.length === 1 ? descendantRepos[0] : null;
  } catch {
    return null;
  }
}
