import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { ProjectCheckoutLitePayload, ScannedGitRepo } from "@getpaseo/protocol/messages";
import { resolveLocalCheckoutWorkspaceTarget } from "./local-checkout-workspace.js";

const PARENT_CWD = resolve("/tmp/parent");
const REPO_CWD = resolve("/tmp/parent/repo");
const OTHER_REPO_CWD = resolve("/tmp/parent/other");

function checkout(input: {
  cwd: string;
  isGit: boolean;
  worktreeRoot?: string | null;
  currentBranch?: string | null;
}): ProjectCheckoutLitePayload {
  return {
    cwd: input.cwd,
    isGit: input.isGit,
    currentBranch: input.isGit ? (input.currentBranch ?? "main") : null,
    remoteUrl: null,
    worktreeRoot: input.isGit ? (input.worktreeRoot ?? input.cwd) : null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  };
}

function repo(path: string, relativePath: string): ScannedGitRepo {
  return {
    path,
    relativePath,
    currentBranch: "main",
    branches: ["main"],
    defaultBranch: null,
  };
}

describe("resolveLocalCheckoutWorkspaceTarget", () => {
  test("keeps a git cwd without scanning child directories", async () => {
    const rootCheckout = checkout({ cwd: REPO_CWD, isGit: true });
    const workspaceGitService = {
      getCheckout: vi.fn(async () => rootCheckout),
    };
    const scanGitRepos = vi.fn(async () => ({ repos: [], truncated: false }));

    await expect(
      resolveLocalCheckoutWorkspaceTarget(REPO_CWD, { workspaceGitService, scanGitRepos }),
    ).resolves.toEqual({
      cwd: REPO_CWD,
      checkout: rootCheckout,
      reason: "input",
    });

    expect(scanGitRepos).not.toHaveBeenCalled();
  });

  test("uses the only child git repo when the selected cwd is its parent", async () => {
    const parentCheckout = checkout({ cwd: PARENT_CWD, isGit: false });
    const childCheckout = checkout({ cwd: REPO_CWD, isGit: true });
    const workspaceGitService = {
      getCheckout: vi.fn(async (cwd: string) =>
        cwd === REPO_CWD ? childCheckout : parentCheckout,
      ),
    };
    const scanGitRepos = vi.fn(async () => ({ repos: [repo(REPO_CWD, "repo")], truncated: false }));

    await expect(
      resolveLocalCheckoutWorkspaceTarget(PARENT_CWD, { workspaceGitService, scanGitRepos }),
    ).resolves.toEqual({
      cwd: REPO_CWD,
      checkout: childCheckout,
      reason: "single-child-git-repo",
    });

    expect(scanGitRepos).toHaveBeenCalledWith({ rootPath: PARENT_CWD, maxDepth: 1 });
    expect(workspaceGitService.getCheckout).toHaveBeenCalledTimes(2);
  });

  test("keeps a non-git parent directory when more than one child repo is present", async () => {
    const parentCheckout = checkout({ cwd: PARENT_CWD, isGit: false });
    const workspaceGitService = {
      getCheckout: vi.fn(async () => parentCheckout),
    };
    const scanGitRepos = vi.fn(async () => ({
      repos: [repo(REPO_CWD, "repo"), repo(OTHER_REPO_CWD, "other")],
      truncated: false,
    }));

    await expect(
      resolveLocalCheckoutWorkspaceTarget(PARENT_CWD, { workspaceGitService, scanGitRepos }),
    ).resolves.toEqual({
      cwd: PARENT_CWD,
      checkout: parentCheckout,
      reason: "input",
    });

    expect(workspaceGitService.getCheckout).toHaveBeenCalledTimes(1);
  });
});
