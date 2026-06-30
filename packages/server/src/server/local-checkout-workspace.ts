import { resolve } from "node:path";
import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import { scanGitRepos, type ScanGitReposInput, type ScanGitReposResult } from "./scan-git-repos.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

const CHILD_REPO_SCAN_DEPTH = 1;

export type LocalCheckoutWorkspaceTargetReason = "input" | "single-child-git-repo";

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

  const childRepoPath = await findSingleChildGitRepo(
    normalizedCwd,
    deps.scanGitRepos ?? scanGitRepos,
  );
  if (!childRepoPath) {
    return { cwd: normalizedCwd, checkout, reason: "input" };
  }

  const childCheckout = await deps.workspaceGitService.getCheckout(childRepoPath);
  if (!childCheckout.isGit) {
    return { cwd: normalizedCwd, checkout, reason: "input" };
  }

  return { cwd: childRepoPath, checkout: childCheckout, reason: "single-child-git-repo" };
}

async function findSingleChildGitRepo(
  cwd: string,
  scan: (input: ScanGitReposInput) => Promise<ScanGitReposResult>,
): Promise<string | null> {
  try {
    const result = await scan({ rootPath: cwd, maxDepth: CHILD_REPO_SCAN_DEPTH });
    const childRepos = result.repos
      .map((repo) => resolve(repo.path))
      .filter((repoPath) => repoPath !== cwd);
    return childRepos.length === 1 ? childRepos[0] : null;
  } catch {
    return null;
  }
}
