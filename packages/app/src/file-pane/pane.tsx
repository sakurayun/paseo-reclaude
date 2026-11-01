import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { usePaneContext } from "@/panels/pane-context";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginFile, PluginTab } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFileHandle, useFileHandleSnapshot } from "@/file-panels/file";
import { FilePanelLoading } from "@/file-panels/loading";
import { FilePanelPicker, FilePanelView, useFilePanelChoice, type FilePanel } from "@/file-panels";
import { useFilePanePathRouting } from "./use-file-pane-path-routing";
import { resolveDirectorySurfacePaths } from "./outside-path";
import { DirectoryBrowser } from "./directory-browser";
import {
  ancestorExplorerPaths,
  isNotAFileError,
  toWorkspaceRelativePath,
} from "@/workspace/classify-workspace-path";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useFileDownload } from "@/hooks/use-file-download";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useToast } from "@/contexts/toast-context";
import { revealItemInFolder } from "@/desktop/shell";
import { isElectronRuntimeMac } from "@/desktop/host";
import { getFileNameFromPath } from "@/attachments/utils";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { useSessionStore } from "@/stores/session-store";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { formatFileSize } from "@/utils/format-file-size";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

/**
 * The file tab: stats the file, picks its panel and mounts it. The panel reads, saves and shows
 * its own loading; the tab only knows the file exists, its kind, and whether the panel has
 * unsaved changes.
 */
export function FilePane({
  serverId,
  workspaceId = null,
  workspaceRoot,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const connected = Boolean(client);
  const root = workspaceRoot.trim();
  const path = location.path.trim();
  const routing = useFilePanePathRouting({ client, path, workspaceRoot: root });
  const target = routing.readTarget;
  const absolutePath = useMemo(
    () => buildAbsoluteExplorerPath({ workspaceRoot: root, entryPath: path }),
    [path, root],
  );
  // A hidden tab or a backgrounded app stops observing; observing again reports what changed.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const handle = useFileHandle({
    serverId,
    target,
    absolutePath,
    observing: isActive && isAppVisible,
  });
  const snapshot = useFileHandleSnapshot(handle);
  const targetKey = target ? `${target.cwd}:${target.path}` : null;
  const { panel, choice } = useFilePanelChoice({
    serverId,
    targetKey,
    path,
    fileKind: snapshot.status === "ready" ? snapshot.kind : null,
    presentable: isActive,
    lineNavigation: location.lineStart ? navigationRevision : null,
  });
  const [modified, setModified] = useState(false);
  usePublishPanelInstanceAttributes({
    modified,
    suspendPendingSave: handle?.holdWrites,
  });
  const panelLocation = useMemo(
    () => ({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      path,
    }),
    [location.lineEnd, location.lineStart, path],
  );

  const directoryPaths = resolveDirectorySurfacePaths({
    ...routing,
    directoryLoadError: snapshot.status === "error" && isNotAFileError(new Error(snapshot.error)),
    path,
    workspaceRoot: root,
  });
  const directorySurface = useDirectoryFileSurface({
    serverId,
    workspaceId,
    workspaceRoot: root,
    ...directoryPaths,
    outsideAbsolutePath: routing.outsideAbsolutePath,
    outsidePathKind: routing.outsidePathKind,
  });
  const binaryActions = useBinaryFileActions({
    serverId,
    workspaceId,
    workspaceRoot: root,
    filePath: path,
  });
  if (directorySurface) return directorySurface;
  let body;
  if (!connected && target) {
    body = <Text style={styles.errorText}>{t("workspace.terminal.hostDisconnected")}</Text>;
  } else if (!handle || snapshot.status === "loading") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelLoading />
      </View>
    );
  } else if (snapshot.status === "missing" || snapshot.status === "error") {
    body = (
      <>
        <Text style={styles.errorText}>
          {snapshot.status === "error" ? snapshot.error : t("panels.file.notFound")}
        </Text>
        <Button variant="outline" size="sm" onPress={handle.retry}>
          {t("common.actions.retry")}
        </Button>
      </>
    );
  } else if (!panel) {
    body = (
      <BinaryFilePreview
        size={snapshot.size}
        onDownload={binaryActions.onDownload}
        onReveal={binaryActions.onReveal}
        revealLabel={binaryActions.revealLabel}
      />
    );
  } else {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelPicker choice={choice} />
        <MountedFilePanel
          key={`${panel.id}:${targetKey}`}
          panel={panel}
          file={handle.file}
          params={panelLocation}
          revision={navigationRevision}
          onModifiedChange={setModified}
        />
      </View>
    );
  }
  return (
    <View style={styles.container} testID="workspace-file-pane">
      <View style={styles.centerState}>{body}</View>
    </View>
  );
}

/** One panel mount. Its tab reports unsaved changes until the panel unmounts. */
function MountedFilePanel({
  panel,
  file,
  params,
  revision,
  onModifiedChange,
}: {
  panel: FilePanel;
  file: PluginFile;
  params: { path: string; lineStart?: number; lineEnd?: number };
  revision: number;
  onModifiedChange: (modified: boolean) => void;
}) {
  const { state, setCurrentTabState } = usePaneContext();
  const tab = useMemo<PluginTab>(
    () => ({
      setModified: onModifiedChange,
      state,
      setState: setCurrentTabState,
    }),
    [onModifiedChange, state, setCurrentTabState],
  );
  useEffect(() => () => onModifiedChange(false), [onModifiedChange]);
  return <FilePanelView panel={panel} file={file} tab={tab} params={params} revision={revision} />;
}

function BinaryFilePreview({
  size,
  onDownload,
  onReveal,
  revealLabel,
}: {
  size: number;
  onDownload?: () => void;
  onReveal?: () => void;
  revealLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.centerState} testID="file-binary-preview">
      <Text style={styles.mutedText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.mutedText}>{formatFileSize(size)}</Text>
      {onDownload || onReveal ? (
        <View style={styles.binaryActions}>
          {onDownload ? (
            <Button variant="outline" size="sm" onPress={onDownload} testID="file-binary-download">
              {t("panels.file.download")}
            </Button>
          ) : null}
          {onReveal ? (
            <Button variant="outline" size="sm" onPress={onReveal} testID="file-binary-reveal">
              {revealLabel ?? t("workspace.fileExplorer.context.revealInFiles")}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function useDirectoryFileSurface(input: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  activeAbsoluteDirectory: string | null;
  outsideAbsolutePath: string | null;
  outsidePathKind: string | null;
  recoveredDirectoryPath: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const openDirectoryInExplorer = useOpenDirectoryInExplorer({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
  });
  const { openFileInWorkspace } = usePaneContext();

  useEffect(() => {
    if (!input.recoveredDirectoryPath) {
      return;
    }
    openDirectoryInExplorer(input.recoveredDirectoryPath);
  }, [input.recoveredDirectoryPath, openDirectoryInExplorer]);

  const handleReopenDirectoryInExplorer = useCallback(() => {
    if (!input.recoveredDirectoryPath) {
      return;
    }
    openDirectoryInExplorer(input.recoveredDirectoryPath);
  }, [input.recoveredDirectoryPath, openDirectoryInExplorer]);

  const handleBrowseFile = useCallback(
    (path: string) => {
      openFileInWorkspace({
        location: { path },
        disposition: "main",
      });
    },
    [openFileInWorkspace],
  );

  if (input.activeAbsoluteDirectory) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <DirectoryBrowser
          serverId={input.serverId}
          absolutePath={input.activeAbsoluteDirectory}
          workspaceRoot={input.workspaceRoot}
          onOpenFile={handleBrowseFile}
        />
      </View>
    );
  }

  if (input.outsideAbsolutePath && input.outsidePathKind === "unknown") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <FilePanelLoading />
          <Text style={styles.mutedText}>{t("panels.file.loading")}</Text>
        </View>
      </View>
    );
  }

  if (input.recoveredDirectoryPath != null) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState} testID="file-directory-redirect">
          <Text style={styles.mutedText}>{t("panels.file.directoryOpenedInExplorer")}</Text>
          <View style={styles.binaryActions}>
            <Button
              variant="outline"
              size="sm"
              onPress={handleReopenDirectoryInExplorer}
              testID="file-directory-open-explorer"
            >
              {t("panels.file.openInExplorer")}
            </Button>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

function useOpenDirectoryInExplorer(input: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}): (relativePath: string) => void {
  const isMobile = useIsCompactFormFactor();
  const setExpandedPathsForWorkspace = usePanelStore((state) => state.setExpandedPathsForWorkspace);
  const { workspaceStateKey, requestDirectoryListing, selectExplorerEntry } =
    useFileExplorerActions({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
    });

  return useCallback(
    (relativePath: string) => {
      const ancestors = ancestorExplorerPaths(relativePath);
      if (workspaceStateKey && ancestors.length > 0) {
        setExpandedPathsForWorkspace(workspaceStateKey, ancestors);
      }
      for (const ancestor of ancestors) {
        void requestDirectoryListing(ancestor, {
          recordHistory: false,
          setCurrentPath: false,
          silent: true,
        });
      }
      void requestDirectoryListing(relativePath, {
        recordHistory: true,
        setCurrentPath: true,
      });
      selectExplorerEntry(relativePath === "." ? null : relativePath);
      openExplorerSidebarView({
        isCompact: isMobile,
        view: "files",
        workspaceKey: input.workspaceId ? `${input.serverId}:${input.workspaceId}` : null,
      });
    },
    [
      input.serverId,
      isMobile,
      requestDirectoryListing,
      selectExplorerEntry,
      setExpandedPathsForWorkspace,
      workspaceStateKey,
      input.workspaceId,
    ],
  );
}

function useBinaryFileActions(input: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  filePath: string | null;
}): {
  onDownload?: () => void;
  onReveal?: () => void;
  revealLabel: string;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(input.serverId);
  const canReveal = getIsElectron() && isLocalDaemon;
  const downloadFile = useFileDownload({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
  });
  const downloadPath = useMemo(() => {
    if (!input.filePath) {
      return null;
    }
    return (
      toWorkspaceRelativePath({
        path: input.filePath,
        workspaceRoot: input.workspaceRoot,
      }) ?? input.filePath
    );
  }, [input.filePath, input.workspaceRoot]);

  const onDownload = useCallback(() => {
    if (!downloadPath) {
      return;
    }
    downloadFile({
      fileName: getFileNameFromPath(downloadPath) ?? downloadPath,
      path: downloadPath,
    });
  }, [downloadFile, downloadPath]);

  const onReveal = useCallback(() => {
    if (!downloadPath) {
      return;
    }
    void revealItemInFolder(
      buildAbsoluteExplorerPath({
        workspaceRoot: input.workspaceRoot,
        entryPath: downloadPath,
      }),
    ).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("panels.file.failedToLoad"));
    });
  }, [downloadPath, input.workspaceRoot, t, toast]);

  const revealLabel = useMemo(() => {
    if (isElectronRuntimeMac()) {
      return t("workspace.fileExplorer.context.revealInFinder");
    }
    const platform = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (/Windows/i.test(platform)) {
      return t("workspace.fileExplorer.context.revealInExplorer");
    }
    return t("workspace.fileExplorer.context.revealInFiles");
  }, [t]);

  return {
    onDownload: downloadPath ? onDownload : undefined,
    onReveal: canReveal && downloadPath ? onReveal : undefined,
    revealLabel,
  };
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  binaryActions: { flexDirection: "row", gap: theme.spacing[2] },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
