import type { GitCommitFile } from "@getpaseo/protocol/messages";

export interface FileTreeLeaf<T> {
  kind: "file";
  name: string;
  file: T;
}

export interface FileTreeDir<T> {
  kind: "dir";
  /** Display name; single-child directory chains collapse into "a/b/c". */
  name: string;
  /** Full path from the repo root, used as the collapse-state key. */
  path: string;
  children: FileTreeNode<T>[];
}

export type FileTreeNode<T> = FileTreeLeaf<T> | FileTreeDir<T>;

export type CommitFileLeaf = FileTreeLeaf<GitCommitFile>;
export type CommitFileDir = FileTreeDir<GitCommitFile>;
export type CommitFileNode = FileTreeNode<GitCommitFile>;

interface MutableDir<T> {
  name: string;
  path: string;
  dirs: Map<string, MutableDir<T>>;
  files: FileTreeLeaf<T>[];
}

function intoNode<T>(dir: MutableDir<T>): FileTreeDir<T> {
  let name = dir.name;
  let path = dir.path;
  let dirs = dir.dirs;
  let files = dir.files;

  // Compress chains of single-child directories (VSCode-style "a/b/c").
  while (files.length === 0 && dirs.size === 1) {
    const [child] = dirs.values();
    name = name ? `${name}/${child.name}` : child.name;
    path = child.path;
    dirs = child.dirs;
    files = child.files;
  }

  const childDirs = [...dirs.values()].map(intoNode).sort((a, b) => a.name.localeCompare(b.name));
  const childFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return { kind: "dir", name, path, children: [...childDirs, ...childFiles] };
}

/** Groups a flat path-keyed file list into a directory tree, directories first. */
export function buildFileTree<T extends { path: string }>(files: readonly T[]): FileTreeNode<T>[] {
  const root: MutableDir<T> = { name: "", path: "", dirs: new Map(), files: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const fileName = segments.pop() ?? file.path;
    let current = root;
    for (const segment of segments) {
      let next = current.dirs.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: current.path ? `${current.path}/${segment}` : segment,
          dirs: new Map(),
          files: [],
        };
        current.dirs.set(segment, next);
      }
      current = next;
    }
    current.files.push({ kind: "file", name: fileName, file });
  }

  // The root level is never compressed — only nested chains collapse.
  const rootDirs = [...root.dirs.values()]
    .map(intoNode)
    .sort((a, b) => a.name.localeCompare(b.name));
  const rootFiles = [...root.files].sort((a, b) => a.name.localeCompare(b.name));
  return [...rootDirs, ...rootFiles];
}

/** Groups a commit's flat file list into a directory tree, directories first. */
export function buildCommitFileTree(files: readonly GitCommitFile[]): CommitFileNode[] {
  return buildFileTree(files);
}

export interface FileTreeRow<T> {
  node: FileTreeNode<T>;
  depth: number;
}

export type CommitFileTreeRow = FileTreeRow<GitCommitFile>;

/** Flattens the tree for rendering, skipping children of collapsed dirs. */
export function flattenFileTree<T>(
  nodes: readonly FileTreeNode<T>[],
  collapsedPaths: ReadonlySet<string>,
  depth = 0,
): FileTreeRow<T>[] {
  const rows: FileTreeRow<T>[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "dir" && !collapsedPaths.has(node.path)) {
      rows.push(...flattenFileTree(node.children, collapsedPaths, depth + 1));
    }
  }
  return rows;
}

/** Flattens the tree for rendering, skipping children of collapsed dirs. */
export function flattenCommitFileTree(
  nodes: readonly CommitFileNode[],
  collapsedPaths: ReadonlySet<string>,
  depth = 0,
): CommitFileTreeRow[] {
  return flattenFileTree(nodes, collapsedPaths, depth);
}
