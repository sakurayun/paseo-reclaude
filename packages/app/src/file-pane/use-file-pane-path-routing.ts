import { useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { toWorkspaceRelativePath } from "@/workspace/classify-workspace-path";
import {
  resolveOutsideAbsolutePath,
  shouldBrowseOutsideAbsoluteDirectory,
  shouldSkipFileReadForOutsidePath,
  type OutsidePathKind,
} from "./outside-path";
import { useOutsidePathKind } from "./use-outside-path-kind";

export function useFilePanePathRouting(input: {
  client: DaemonClient | null;
  path: string | null;
  workspaceRoot: string;
}): {
  workspaceRelativePath: string | null;
  directoryRelativePath: string | null;
  outsideAbsolutePath: string | null;
  outsidePathKind: OutsidePathKind | null;
  browseAbsoluteDirectory: string | null;
  readTarget: { cwd: string; path: string } | null;
} {
  const workspaceRelativePath = useMemo(() => {
    if (!input.path) {
      return null;
    }
    return toWorkspaceRelativePath({
      path: input.path,
      workspaceRoot: input.workspaceRoot,
    });
  }, [input.path, input.workspaceRoot]);

  const directoryRelativePath = useMemo(() => {
    if (!input.path) {
      return null;
    }
    if (input.path.endsWith("/")) {
      return workspaceRelativePath ?? ".";
    }
    return workspaceRelativePath === "." ? "." : null;
  }, [input.path, workspaceRelativePath]);

  const outsideAbsolutePath = useMemo(
    () =>
      resolveOutsideAbsolutePath({
        path: input.path,
        workspaceRoot: input.workspaceRoot,
      }),
    [input.path, input.workspaceRoot],
  );

  const outsidePathKind = useOutsidePathKind({
    client: input.client,
    workspaceRoot: input.workspaceRoot,
    outsideAbsolutePath,
  });

  const browseAbsoluteDirectory = shouldBrowseOutsideAbsoluteDirectory({
    outsideAbsolutePath,
    outsidePathKind,
  });

  const skipOutsideFileRead = shouldSkipFileReadForOutsidePath({
    outsideAbsolutePath,
    outsidePathKind,
  });

  const readTarget = useMemo(() => {
    if (!input.path || directoryRelativePath || browseAbsoluteDirectory || skipOutsideFileRead) {
      return null;
    }
    return resolveFilePreviewReadTarget({
      path: input.path,
      workspaceRoot: input.workspaceRoot,
    });
  }, [
    browseAbsoluteDirectory,
    directoryRelativePath,
    input.path,
    input.workspaceRoot,
    skipOutsideFileRead,
  ]);

  return {
    workspaceRelativePath,
    directoryRelativePath,
    outsideAbsolutePath,
    outsidePathKind,
    browseAbsoluteDirectory,
    readTarget,
  };
}
