import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanGitRepos } from "./scan-git-repos.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initRepo(path: string, branches: string[]): Promise<void> {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", branches[0] ?? "main");
  await git(path, "config", "user.email", "test@example.com");
  await git(path, "config", "user.name", "Test");
  await writeFile(join(path, "README.md"), "test");
  await git(path, "add", ".");
  await git(path, "commit", "-m", "init");
  for (const branch of branches.slice(1)) {
    await git(path, "branch", branch);
  }
}

describe("scanGitRepos", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), "paseo-scan-git-repos-"));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it("finds the root repo and nested sub-repos with their branches", async () => {
    await initRepo(rootPath, ["main", "feature/a"]);
    await initRepo(join(rootPath, "vendor-lib"), ["develop"]);
    await initRepo(join(rootPath, "apps", "deep", "inner"), ["main", "release"]);

    const result = await scanGitRepos({ rootPath });

    expect(result.truncated).toBe(false);
    expect(result.repos.map((repo) => repo.relativePath)).toEqual([
      ".",
      join("apps", "deep", "inner"),
      "vendor-lib",
    ]);

    const root = result.repos[0]!;
    expect(root.currentBranch).toBe("main");
    expect(new Set(root.branches)).toEqual(new Set(["main", "feature/a"]));

    const inner = result.repos[1]!;
    expect(new Set(inner.branches)).toEqual(new Set(["main", "release"]));

    const vendor = result.repos[2]!;
    expect(vendor.currentBranch).toBe("develop");
    expect(vendor.branches).toEqual(["develop"]);
  });

  it("skips node_modules and hidden directories", async () => {
    await initRepo(join(rootPath, "node_modules", "dep"), ["main"]);
    await initRepo(join(rootPath, ".cache", "repo"), ["main"]);
    await initRepo(join(rootPath, "real"), ["main"]);

    const result = await scanGitRepos({ rootPath });

    expect(result.repos.map((repo) => repo.relativePath)).toEqual(["real"]);
  });

  it("respects maxDepth", async () => {
    await initRepo(join(rootPath, "a", "b", "c"), ["main"]);

    const shallow = await scanGitRepos({ rootPath, maxDepth: 2 });
    expect(shallow.repos).toEqual([]);

    const deep = await scanGitRepos({ rootPath, maxDepth: 3 });
    expect(deep.repos.map((repo) => repo.relativePath)).toEqual([join("a", "b", "c")]);
  });

  it("throws for a non-directory root", async () => {
    const filePath = join(rootPath, "file.txt");
    await writeFile(filePath, "x");
    await expect(scanGitRepos({ rootPath: filePath })).rejects.toThrow("Not a directory");
  });
});
