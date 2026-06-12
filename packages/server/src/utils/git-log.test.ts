import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCheckoutLog,
  getCommitFiles,
  parseGitLogOutput,
  parseNameStatusOutput,
} from "./git-log.js";

const execFileAsync = promisify(execFile);

const US = "\u001f";
const NUL = "\u0000";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function initRepo(path: string): Promise<void> {
  await git(path, "init", "-b", "main");
  await git(path, "config", "user.email", "test@example.com");
  await git(path, "config", "user.name", "Test");
}

async function commit(cwd: string, message: string): Promise<string> {
  await git(cwd, "commit", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

describe("parseGitLogOutput", () => {
  function record(fields: {
    hash: string;
    parents?: string;
    authorName?: string;
    authorEmail?: string;
    authorDate?: string;
    refs?: string;
    subject?: string;
    body?: string;
  }): string {
    return [
      fields.hash,
      fields.parents ?? "",
      fields.authorName ?? "Test",
      fields.authorEmail ?? "test@example.com",
      fields.authorDate ?? "2026-06-12T00:00:00+00:00",
      fields.refs ?? "",
      fields.subject ?? "subject",
      fields.body ?? "",
    ].join(US);
  }

  it("returns no commits for empty output", () => {
    expect(parseGitLogOutput("")).toEqual([]);
  });

  it("parses a merge commit with multiple parents", () => {
    const parsed = parseGitLogOutput(record({ hash: "abc", parents: "p1 p2", subject: "merge" }));
    expect(parsed).toEqual([
      {
        hash: "abc",
        parents: ["p1", "p2"],
        subject: "merge",
        body: "",
        authorName: "Test",
        authorEmail: "test@example.com",
        authorDate: "2026-06-12T00:00:00+00:00",
        refs: [],
      },
    ]);
  });

  it("keeps multi-line bodies and trims trailing whitespace", () => {
    const parsed = parseGitLogOutput(record({ hash: "abc", body: "line one\n\nline two\n" }));
    expect(parsed[0]?.body).toBe("line one\n\nline two");
  });

  it("parses root commits (no parents) and empty refs", () => {
    const parsed = parseGitLogOutput(record({ hash: "abc" }));
    expect(parsed[0]?.parents).toEqual([]);
    expect(parsed[0]?.refs).toEqual([]);
  });

  it("splits decorations into individual refs", () => {
    const parsed = parseGitLogOutput(
      record({ hash: "abc", refs: "HEAD -> main, tag: v1.0, origin/main" }),
    );
    expect(parsed[0]?.refs).toEqual(["HEAD -> main", "tag: v1.0", "origin/main"]);
  });

  it("keeps subjects containing field-like characters intact", () => {
    const subject = 'feat: add "%H" placeholders, commas, and 中文';
    const parsed = parseGitLogOutput(record({ hash: "abc", subject }));
    expect(parsed[0]?.subject).toBe(subject);
  });

  it("parses multiple NUL-separated records", () => {
    const stdout = [record({ hash: "a1" }), record({ hash: "b2" })].join(NUL);
    expect(parseGitLogOutput(stdout).map((c) => c.hash)).toEqual(["a1", "b2"]);
  });
});

describe("parseNameStatusOutput", () => {
  it("returns no files for empty output", () => {
    expect(parseNameStatusOutput("")).toEqual([]);
  });

  it("parses added, modified, and deleted entries", () => {
    const stdout = ["A", "new.ts", "M", "src/changed.ts", "D", "old.ts"].join(NUL);
    expect(parseNameStatusOutput(stdout)).toEqual([
      { path: "new.ts", oldPath: null, status: "added" },
      { path: "src/changed.ts", oldPath: null, status: "modified" },
      { path: "old.ts", oldPath: null, status: "deleted" },
    ]);
  });

  it("parses renames with similarity scores and old paths", () => {
    const stdout = ["R100", "before.ts", "after.ts"].join(NUL);
    expect(parseNameStatusOutput(stdout)).toEqual([
      { path: "after.ts", oldPath: "before.ts", status: "renamed" },
    ]);
  });
});

describe("getCommitFiles", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), "paseo-commit-files-"));
    await initRepo(repoPath);
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("lists files introduced by a root commit", async () => {
    await writeFile(join(repoPath, "a.txt"), "a");
    await git(repoPath, "add", ".");
    const hash = await commit(repoPath, "root");

    const files = await getCommitFiles({ cwd: repoPath, hash });
    expect(files).toEqual([{ path: "a.txt", oldPath: null, status: "added" }]);
  });

  it("diffs a commit against its first parent, detecting renames", async () => {
    await writeFile(join(repoPath, "a.txt"), "stable content for rename detection\n");
    await git(repoPath, "add", ".");
    await commit(repoPath, "add a");

    await git(repoPath, "mv", "a.txt", "b.txt");
    await writeFile(join(repoPath, "c.txt"), "c");
    await git(repoPath, "add", ".");
    const hash = await commit(repoPath, "rename and add");

    const files = await getCommitFiles({ cwd: repoPath, hash });
    expect(files).toEqual(
      expect.arrayContaining([
        { path: "b.txt", oldPath: "a.txt", status: "renamed" },
        { path: "c.txt", oldPath: null, status: "added" },
      ]),
    );
  });

  it("rejects malformed hashes", async () => {
    await expect(getCommitFiles({ cwd: repoPath, hash: "HEAD; rm -rf /" })).rejects.toThrow(
      /Invalid commit hash/,
    );
  });
});

describe("getCheckoutLog", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), "paseo-git-log-"));
    await initRepo(repoPath);
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("returns empty history for an unborn HEAD", async () => {
    const result = await getCheckoutLog({ cwd: repoPath });
    expect(result).toEqual({ commits: [], anchor: null, hasMore: false });
  });

  it("returns commits newest-first with refs on HEAD", async () => {
    await commit(repoPath, "first");
    const head = await commit(repoPath, "second");

    const result = await getCheckoutLog({ cwd: repoPath });

    expect(result.anchor).toBe(head);
    expect(result.hasMore).toBe(false);
    expect(result.commits.map((c) => c.subject)).toEqual(["second", "first"]);
    expect(result.commits[0]?.refs).toContain("HEAD -> main");
    expect(result.commits[1]?.parents).toEqual([]);
    expect(result.commits[0]?.parents).toEqual([result.commits[1]?.hash]);
  });

  it("paginates with a stable anchor even when new commits land", async () => {
    for (let i = 1; i <= 5; i += 1) {
      await commit(repoPath, `c${i}`);
    }

    const firstPage = await getCheckoutLog({ cwd: repoPath, limit: 2 });
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.commits.map((c) => c.subject)).toEqual(["c5", "c4"]);

    // A new commit after the first page must not shift later pages.
    await commit(repoPath, "c6");

    const secondPage = await getCheckoutLog({
      cwd: repoPath,
      limit: 2,
      anchor: firstPage.anchor ?? undefined,
      skip: 2,
    });
    expect(secondPage.commits.map((c) => c.subject)).toEqual(["c3", "c2"]);
    expect(secondPage.hasMore).toBe(true);

    const lastPage = await getCheckoutLog({
      cwd: repoPath,
      limit: 2,
      anchor: firstPage.anchor ?? undefined,
      skip: 4,
    });
    expect(lastPage.commits.map((c) => c.subject)).toEqual(["c1"]);
    expect(lastPage.hasMore).toBe(false);
  });

  it("records merge parents for graph layout", async () => {
    await commit(repoPath, "base");
    await git(repoPath, "checkout", "-b", "feature");
    const featureTip = await commit(repoPath, "feature work");
    await git(repoPath, "checkout", "main");
    const mainTip = await commit(repoPath, "main work");
    await git(repoPath, "merge", "--no-ff", "-m", "merge feature", "feature");

    const result = await getCheckoutLog({ cwd: repoPath });
    const merge = result.commits[0];
    expect(merge?.subject).toBe("merge feature");
    expect(merge?.parents).toEqual([mainTip, featureTip]);
  });
});
