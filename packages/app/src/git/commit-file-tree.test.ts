import { describe, expect, it } from "vitest";
import type { GitCommitFile } from "@getpaseo/protocol/messages";
import { buildCommitFileTree, flattenCommitFileTree } from "./commit-file-tree";

function file(path: string): GitCommitFile {
  return { path, oldPath: null, status: "modified" };
}

describe("buildCommitFileTree", () => {
  it("returns an empty tree for no files", () => {
    expect(buildCommitFileTree([])).toEqual([]);
  });

  it("keeps root files at the top level", () => {
    const tree = buildCommitFileTree([file("README.md"), file("Makefile")]);
    expect(tree.map((node) => node.kind)).toEqual(["file", "file"]);
    expect(tree.map((node) => node.name)).toEqual(["Makefile", "README.md"]);
  });

  it("groups files into directories, dirs before files", () => {
    const tree = buildCommitFileTree([file("README.md"), file("src/a.ts"), file("src/b.ts")]);
    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ["dir", "src"],
      ["file", "README.md"],
    ]);
    const src = tree[0];
    if (src.kind !== "dir") throw new Error("expected dir");
    expect(src.children.map((node) => node.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("compresses single-child directory chains", () => {
    const tree = buildCommitFileTree([
      file("packages/app/src/git/a.ts"),
      file("packages/app/src/git/b.ts"),
    ]);
    expect(tree).toHaveLength(1);
    const dir = tree[0];
    if (dir.kind !== "dir") throw new Error("expected dir");
    expect(dir.name).toBe("packages/app/src/git");
    expect(dir.path).toBe("packages/app/src/git");
    expect(dir.children.map((node) => node.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("stops compressing where the tree branches", () => {
    const tree = buildCommitFileTree([file("src/git/a.ts"), file("src/components/b.tsx")]);
    const src = tree[0];
    if (src.kind !== "dir") throw new Error("expected dir");
    expect(src.name).toBe("src");
    expect(src.children.map((node) => node.name)).toEqual(["components", "git"]);
  });
});

describe("flattenCommitFileTree", () => {
  it("flattens with depth and skips collapsed directories", () => {
    const tree = buildCommitFileTree([file("src/a.ts"), file("README.md")]);
    const open = flattenCommitFileTree(tree, new Set());
    expect(open.map((row) => [row.node.name, row.depth])).toEqual([
      ["src", 0],
      ["a.ts", 1],
      ["README.md", 0],
    ]);

    const collapsed = flattenCommitFileTree(tree, new Set(["src"]));
    expect(collapsed.map((row) => row.node.name)).toEqual(["src", "README.md"]);
  });
});
