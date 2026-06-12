import { describe, expect, it } from "vitest";
import {
  countTextBufferLines,
  GitOpValidationError,
  parseGitNumstat,
  parseGitRemotes,
  parseGitStatusFiles,
  parseGitTags,
  planGitOp,
  requirePaths,
} from "./git-ops.js";

describe("planGitOp", () => {
  it("maps parameterless ops to fixed argv", () => {
    expect(planGitOp({ op: "fetch" }).commands).toEqual([["fetch"]]);
    expect(planGitOp({ op: "fetch-prune" }).commands).toEqual([["fetch", "--prune"]]);
    expect(planGitOp({ op: "pull-rebase" }).commands).toEqual([["pull", "--rebase"]]);
    expect(planGitOp({ op: "stage-all" }).commands).toEqual([["add", "-A"]]);
    expect(planGitOp({ op: "unstage-all" }).commands).toEqual([["reset"]]);
    expect(planGitOp({ op: "undo-last-commit" }).commands).toEqual([["reset", "--soft", "HEAD~1"]]);
    expect(planGitOp({ op: "abort-rebase" }).commands).toEqual([["rebase", "--abort"]]);
    expect(planGitOp({ op: "publish-branch" }).commands).toEqual([
      ["push", "-u", "origin", "HEAD"],
    ]);
    expect(planGitOp({ op: "stash-clear" }).commands).toEqual([["stash", "clear"]]);
    expect(planGitOp({ op: "push-tags" }).commands).toEqual([["push", "--tags"]]);
  });

  it("discard-all resets tracked changes then removes untracked files", () => {
    expect(planGitOp({ op: "discard-all" }).commands).toEqual([
      ["reset", "--hard", "HEAD"],
      ["clean", "-fd"],
    ]);
  });

  it("commit-amend keeps the old message unless a new one is provided", () => {
    expect(planGitOp({ op: "commit-amend" }).commands).toEqual([
      ["commit", "--amend", "--no-edit"],
    ]);
    expect(planGitOp({ op: "commit-amend", message: "new msg" }).commands).toEqual([
      ["commit", "--amend", "-m", "new msg"],
    ]);
    expect(planGitOp({ op: "commit-amend", addAll: true }).commands).toEqual([
      ["add", "-A"],
      ["commit", "--amend", "--no-edit"],
    ]);
  });

  it("interpolates validated names", () => {
    expect(planGitOp({ op: "create-branch", name: "feat/x" }).commands).toEqual([
      ["checkout", "-b", "feat/x"],
    ]);
    expect(planGitOp({ op: "merge-ref", name: "origin/main" }).commands).toEqual([
      ["merge", "origin/main"],
    ]);
    expect(
      planGitOp({ op: "remote-add", name: "upstream", url: "https://example.com/r.git" }).commands,
    ).toEqual([["remote", "add", "upstream", "https://example.com/r.git"]]);
    expect(planGitOp({ op: "tag-delete-remote", name: "v1.0.0" }).commands).toEqual([
      ["push", "origin", ":refs/tags/v1.0.0"],
    ]);
  });

  it("builds stash refs from the index", () => {
    expect(planGitOp({ op: "stash-apply", stashIndex: 2 }).commands).toEqual([
      ["stash", "apply", "stash@{2}"],
    ]);
    expect(planGitOp({ op: "stash-drop", stashIndex: 0 }).commands).toEqual([
      ["stash", "drop", "stash@{0}"],
    ]);
  });

  it("maps path ops with pathspec separators", () => {
    expect(planGitOp({ op: "stage-paths", paths: ["a.ts", "dir/b.ts"] }).commands).toEqual([
      ["add", "--", "a.ts", "dir/b.ts"],
    ]);
    expect(planGitOp({ op: "unstage-paths", paths: ["a.ts"] }).commands).toEqual([
      ["reset", "--", "a.ts"],
    ]);
    expect(planGitOp({ op: "discard-paths", paths: ["with space.ts"] }).commands).toEqual([
      ["checkout", "--", "with space.ts"],
    ]);
    expect(planGitOp({ op: "clean-paths", paths: ["untracked/"] }).commands).toEqual([
      ["clean", "-fd", "--", "untracked/"],
    ]);
    expect(planGitOp({ op: "stash-paths", paths: ["a.ts"] }).commands).toEqual([
      ["stash", "push", "--include-untracked", "--", "a.ts"],
    ]);
    expect(planGitOp({ op: "diff-paths", paths: ["a.ts", "b.ts"] }).commands).toEqual([
      ["diff", "HEAD", "--", "a.ts", "b.ts"],
    ]);
  });

  it("rejects missing or dangerous parameters", () => {
    expect(() => planGitOp({ op: "create-branch" })).toThrow(GitOpValidationError);
    expect(() => planGitOp({ op: "create-branch", name: "--force" })).toThrow(GitOpValidationError);
    expect(() => planGitOp({ op: "merge-ref", name: "a b" })).toThrow(GitOpValidationError);
    expect(() => planGitOp({ op: "tag-create", name: "a..b" })).toThrow(GitOpValidationError);
    expect(() => planGitOp({ op: "remote-add", name: "upstream", url: "--upload-pack=x" })).toThrow(
      GitOpValidationError,
    );
    expect(() => planGitOp({ op: "stash-apply" })).toThrow(GitOpValidationError);
    expect(() => planGitOp({ op: "stash-apply", stashIndex: -1 })).toThrow(GitOpValidationError);
  });
});

describe("requirePaths", () => {
  it("accepts repo-relative paths with spaces", () => {
    expect(requirePaths(["src/a b.ts", "dir/"])).toEqual(["src/a b.ts", "dir/"]);
  });

  it("rejects empty, flag-like, absolute, and traversal paths", () => {
    expect(() => requirePaths(undefined)).toThrow(GitOpValidationError);
    expect(() => requirePaths([])).toThrow(GitOpValidationError);
    expect(() => requirePaths(["--force"])).toThrow(GitOpValidationError);
    expect(() => requirePaths(["/etc/passwd"])).toThrow(GitOpValidationError);
    expect(() => requirePaths(["C:\\windows"])).toThrow(GitOpValidationError);
    expect(() => requirePaths(["../outside.ts"])).toThrow(GitOpValidationError);
  });
});

describe("parseGitStatusFiles", () => {
  it("parses porcelain -z entries with index and worktree status", () => {
    const output = ["M  staged.ts", " M unstaged.ts", "MM both.ts", "?? new-file.ts", ""].join(
      "\0",
    );
    expect(parseGitStatusFiles(output)).toEqual([
      { path: "staged.ts", indexStatus: "M", worktreeStatus: " " },
      { path: "unstaged.ts", indexStatus: " ", worktreeStatus: "M" },
      { path: "both.ts", indexStatus: "M", worktreeStatus: "M" },
      { path: "new-file.ts", indexStatus: "?", worktreeStatus: "?" },
    ]);
  });

  it("skips the original path token of renames", () => {
    const output = ["R  new-name.ts", "old-name.ts", " M other.ts", ""].join("\0");
    expect(parseGitStatusFiles(output)).toEqual([
      { path: "new-name.ts", indexStatus: "R", worktreeStatus: " " },
      { path: "other.ts", indexStatus: " ", worktreeStatus: "M" },
    ]);
  });

  it("returns empty for clean tree", () => {
    expect(parseGitStatusFiles("")).toEqual([]);
  });
});

describe("countTextBufferLines", () => {
  it("counts newline-terminated and unterminated lines", () => {
    expect(countTextBufferLines(Buffer.from(""))).toBe(0);
    expect(countTextBufferLines(Buffer.from("a\nb\n"))).toBe(2);
    expect(countTextBufferLines(Buffer.from("a\nb"))).toBe(2);
    expect(countTextBufferLines(Buffer.from("single"))).toBe(1);
  });

  it("returns null for binary content", () => {
    expect(countTextBufferLines(Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
  });
});

describe("parseGitNumstat", () => {
  it("parses additions and deletions per path", () => {
    const output = "12\t3\tsrc/a.ts\n0\t7\tREADME.md\n";
    expect(parseGitNumstat(output)).toEqual([
      { path: "src/a.ts", additions: 12, deletions: 3 },
      { path: "README.md", additions: 0, deletions: 7 },
    ]);
  });

  it("skips binary entries and resolves rename notation", () => {
    const output = ["-\t-\timage.png", "5\t1\tsrc/{old => new}/file.ts", "2\t0\ta.ts => b.ts"].join(
      "\n",
    );
    expect(parseGitNumstat(output)).toEqual([
      { path: "src/new/file.ts", additions: 5, deletions: 1 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ]);
  });

  it("returns empty for no output", () => {
    expect(parseGitNumstat("")).toEqual([]);
  });
});

describe("parseGitRemotes", () => {
  it("dedupes fetch/push pairs, preferring the fetch URL", () => {
    const output = [
      "origin\thttps://example.com/a.git (fetch)",
      "origin\thttps://example.com/a.git (push)",
      "upstream\tgit@example.com:b.git (fetch)",
      "upstream\tgit@example.com:b-push.git (push)",
    ].join("\n");
    expect(parseGitRemotes(output)).toEqual([
      { name: "origin", url: "https://example.com/a.git" },
      { name: "upstream", url: "git@example.com:b.git" },
    ]);
  });

  it("returns empty for no remotes", () => {
    expect(parseGitRemotes("")).toEqual([]);
  });
});

describe("parseGitTags", () => {
  it("splits lines and drops blanks", () => {
    expect(parseGitTags("v1.0.0\nv1.1.0\n\n")).toEqual(["v1.0.0", "v1.1.0"]);
    expect(parseGitTags("")).toEqual([]);
  });
});
