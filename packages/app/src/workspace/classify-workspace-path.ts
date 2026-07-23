import { isAbsolutePath } from "@/utils/path";
import { getExplorerParentPath } from "@/file-explorer/paths";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

/**
 * - `directory` / `file`: path is inside the workspace; `relativePath` is explorer-relative.
 * - `absolute-directory` / `absolute-file`: path is absolute and outside the workspace.
 */
export type ClassifiedWorkspacePath =
  | { kind: "directory"; relativePath: string }
  | { kind: "file"; relativePath: string }
  | { kind: "absolute-directory"; absolutePath: string }
  | { kind: "absolute-file"; absolutePath: string };

export interface DirectoryListEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface DirectoryListResult {
  path: string;
  entries: DirectoryListEntry[];
}

/**
 * Classifies a path as a directory or file without reading file contents.
 *
 * Inside the workspace: uses the workspace root as the listDirectory scope.
 * Outside the workspace (e.g. `cd ..` then click `pwd`): probes the absolute
 * path itself via `listDirectory(absolutePath, ".")`.
 */
export async function classifyWorkspacePath(input: {
  listDirectory: (cwd: string, path: string) => Promise<DirectoryListResult>;
  workspaceRoot: string;
  path: string;
}): Promise<ClassifiedWorkspacePath | null> {
  const workspaceRoot = input.workspaceRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = input.path.trim().replace(/\\/g, "/");
  if (!workspaceRoot || !candidate) {
    return null;
  }

  const relativePath = toWorkspaceRelativePath({ path: candidate, workspaceRoot });
  if (relativePath) {
    return classifyInsideWorkspace({
      listDirectory: input.listDirectory,
      workspaceRoot,
      relativePath,
    });
  }

  if (!isAbsolutePath(candidate)) {
    return null;
  }

  return classifyAbsoluteOutsideWorkspace({
    listDirectory: input.listDirectory,
    absolutePath: candidate,
  });
}

async function classifyInsideWorkspace(input: {
  listDirectory: (cwd: string, path: string) => Promise<DirectoryListResult>;
  workspaceRoot: string;
  relativePath: string;
}): Promise<ClassifiedWorkspacePath | null> {
  const { relativePath, workspaceRoot } = input;

  // Workspace root is always a directory (e.g. clicking the workspace `pwd` path).
  if (relativePath === ".") {
    return { kind: "directory", relativePath: "." };
  }

  try {
    await input.listDirectory(workspaceRoot, relativePath);
    return { kind: "directory", relativePath };
  } catch (error) {
    if (isNotADirectoryError(error)) {
      return { kind: "file", relativePath };
    }
  }

  // Fallback: classify from the parent listing when a direct probe fails for
  // transient reasons (permissions, races) other than "not a directory".
  const parentPath = getExplorerParentPath(relativePath);
  const entryName = relativePath.includes("/")
    ? (relativePath.slice(relativePath.lastIndexOf("/") + 1) ?? relativePath)
    : relativePath;

  try {
    const listing = await input.listDirectory(workspaceRoot, parentPath);
    const match = listing.entries.find((entry) => entry.name === entryName);
    if (match) {
      return {
        kind: match.kind,
        relativePath: match.path || relativePath,
      };
    }
  } catch {
    // Ignore and report unclassified below.
  }

  return null;
}

async function classifyAbsoluteOutsideWorkspace(input: {
  listDirectory: (cwd: string, path: string) => Promise<DirectoryListResult>;
  absolutePath: string;
}): Promise<ClassifiedWorkspacePath | null> {
  try {
    // Scope the listing root to the path itself — the daemon only allows paths
    // under the provided root, so this is how we probe outside-workspace dirs.
    await input.listDirectory(input.absolutePath, ".");
    return { kind: "absolute-directory", absolutePath: input.absolutePath };
  } catch (error) {
    if (isNotADirectoryError(error)) {
      return { kind: "absolute-file", absolutePath: input.absolutePath };
    }
  }
  return null;
}

export function toWorkspaceRelativePath(input: {
  path: string;
  workspaceRoot: string;
}): string | null {
  const pathValue = input.path.trim().replace(/\\/g, "/");
  const workspaceRoot = input.workspaceRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!pathValue || !workspaceRoot) {
    return null;
  }

  if (
    pathValue === workspaceRoot ||
    pathValue === `${workspaceRoot}/` ||
    pathsEqualIgnoreTrailingSlash(pathValue, workspaceRoot)
  ) {
    return ".";
  }

  if (!isAbsolutePath(pathValue)) {
    const relative = pathValue.replace(/^\.\/+/, "").replace(/\/+$/, "");
    return relative.length > 0 ? relative : ".";
  }

  const resolved = resolveWorkspaceFilePaths({
    path: pathValue,
    workspaceRoot,
  });
  if (!resolved) {
    // resolveWorkspaceFilePaths returns null for the workspace root itself.
    if (pathsEqualIgnoreTrailingSlash(pathValue, workspaceRoot)) {
      return ".";
    }
    return null;
  }
  return resolved.relativePath ?? null;
}

export function ancestorExplorerPaths(relativePath: string): string[] {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return [];
  }

  const segments = normalized.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join("/"));
  }
  return ancestors;
}

export function joinAbsolutePath(parent: string, childName: string): string {
  const base = parent.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const child = childName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (base === "/") {
    return `/${child}`;
  }
  return `${base}/${child}`;
}

export function isNotADirectoryError(error: unknown): boolean {
  return error instanceof Error && /not a directory/i.test(error.message);
}

export function isNotAFileError(error: unknown): boolean {
  return error instanceof Error && /not a file/i.test(error.message);
}

function pathsEqualIgnoreTrailingSlash(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/, "") || "/";
  return normalize(left) === normalize(right);
}
