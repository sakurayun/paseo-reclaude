import { isAbsolutePath } from "@/utils/path";
import { toWorkspaceRelativePath } from "@/workspace/classify-workspace-path";

export type OutsidePathKind = "directory" | "file" | "unknown";

export function resolveOutsideAbsolutePath(input: {
  path: string | null;
  workspaceRoot: string;
}): string | null {
  if (!input.path || !isAbsolutePath(input.path)) {
    return null;
  }
  const relative = toWorkspaceRelativePath({
    path: input.path,
    workspaceRoot: input.workspaceRoot,
  });
  if (relative != null) {
    return null;
  }
  return input.path;
}

export function shouldBrowseOutsideAbsoluteDirectory(input: {
  outsideAbsolutePath: string | null;
  outsidePathKind: OutsidePathKind | null;
}): string | null {
  if (!input.outsideAbsolutePath || input.outsidePathKind !== "directory") {
    return null;
  }
  return input.outsideAbsolutePath;
}

export function shouldSkipFileReadForOutsidePath(input: {
  outsideAbsolutePath: string | null;
  outsidePathKind: OutsidePathKind | null;
}): boolean {
  return Boolean(input.outsideAbsolutePath && input.outsidePathKind !== "file");
}

export function resolveDirectorySurfacePaths(input: {
  directoryRelativePath: string | null;
  outsideAbsolutePath: string | null;
  browseAbsoluteDirectory: string | null;
  directoryLoadError: boolean;
  path: string | null;
  workspaceRoot: string;
}): {
  activeAbsoluteDirectory: string | null;
  recoveredDirectoryPath: string | null;
} {
  const recoveredAbsoluteDirectory =
    input.directoryLoadError && input.outsideAbsolutePath ? input.outsideAbsolutePath : null;
  const activeAbsoluteDirectory = input.browseAbsoluteDirectory ?? recoveredAbsoluteDirectory;

  if (input.directoryRelativePath) {
    return {
      activeAbsoluteDirectory,
      recoveredDirectoryPath: input.directoryRelativePath,
    };
  }

  if (input.directoryLoadError && input.path && !input.outsideAbsolutePath) {
    return {
      activeAbsoluteDirectory,
      recoveredDirectoryPath: toWorkspaceRelativePath({
        path: input.path,
        workspaceRoot: input.workspaceRoot,
      }),
    };
  }

  return {
    activeAbsoluteDirectory,
    recoveredDirectoryPath: null,
  };
}
