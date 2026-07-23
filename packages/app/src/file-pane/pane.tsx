import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DaemonClient, FileReadResult } from "@getpaseo/client/internal/daemon-client";
import type { FileVersion } from "@getpaseo/protocol/messages";
import {
  ActivityIndicator,
  Image as RNImage,
  ScrollView as RNScrollView,
  Text,
  View,
} from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { highlightCode, type HighlightToken } from "@getpaseo/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import {
  ancestorExplorerPaths,
  isNotAFileError,
  toWorkspaceRelativePath,
} from "@/workspace/classify-workspace-path";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { isFileQueryEnabled } from "@/components/file-pane-enabled";
import { getIsElectron, isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { useLiveFile } from "./live-file";
import { FilePanelBar } from "./bar";
import { FileEditorModel, type FileEditorFile } from "./editor/model";
import { FileEditorView } from "./editor/view";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { Button } from "@/components/ui/button";
import { useFileDownload } from "@/hooks/use-file-download";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { usePanelStore } from "@/stores/panel-store";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { revealItemInFolder } from "@/desktop/shell";
import { isElectronRuntimeMac } from "@/desktop/host";
import { useToast } from "@/contexts/toast-context";
import { DirectoryBrowser } from "./directory-browser";
import { usePaneContext } from "@/panels/pane-context";
import { useFilePanePathRouting } from "./use-file-pane-path-routing";
import { resolveDirectorySurfacePaths } from "./outside-path";

interface CodeLineProps {
  tokens: HighlightToken[];
  lineNumber: number;
  gutterWidth: number;
  highlighted: boolean;
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  onDownloadBinary?: () => void;
  onRevealBinary?: () => void;
  revealBinaryLabel?: string;
}

type TextExplorerFile = ExplorerFile & { kind: "text" };

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
}> {
  if (!file) {
    return { file: null, imageAttachment: null };
  }

  const explorerFile = explorerFileFromReadResult(file);
  if (file.kind !== "image") {
    return { file: explorerFile, imageAttachment: null };
  }

  const imageAttachment = await persistAttachmentFromBytes({
    id: createPreviewAttachmentId({
      mimeType: file.mime,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
    }),
    bytes: file.bytes,
    mimeType: file.mime,
    fileName: getFileNameFromPath(file.path),
  });

  return {
    file: explorerFile,
    imageAttachment,
  };
}

function clampLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) {
    return null;
  }
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

const CodeLine = React.memo(function CodeLine({
  tokens,
  lineNumber,
  gutterWidth,
  highlighted,
}: CodeLineProps) {
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <View style={lineStyle}>
      <View style={gutterStyle}>
        <Text numberOfLines={1} style={codeLineStyles.gutterText}>
          {String(lineNumber)}
        </Text>
      </View>
      <Text selectable style={codeLineStyles.lineText}>
        {keyedTokens.map(({ key, token }) => (
          <CodeLineToken key={key} token={token} />
        ))}
      </Text>
    </View>
  );
});

interface CodeLineTokenProps {
  token: HighlightToken;
}

function CodeLineToken({ token }: CodeLineTokenProps) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: theme.spacing[3],
    flexShrink: 0,
  },
  gutterText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    opacity: 0.4,
    userSelect: "none",
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    flex: 1,
  },
}));

function FilePreviewBody({
  preview,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  onDownloadBinary,
  onRevealBinary,
  revealBinaryLabel,
}: FilePreviewBodyProps) {
  const theme = UnistylesRuntime.getTheme();
  const { t } = useTranslation();
  const filePath = location.path;
  const isMarkdownFile =
    preview?.kind === "text" && isRenderedMarkdownFile(filePath) && !location.lineStart;

  const previewScrollRef = useRef<RNScrollView>(null);

  const highlightedLines = useMemo(() => {
    if (!preview || preview.kind !== "text" || isMarkdownFile) {
      return null;
    }

    return highlightCode(preview.content ?? "", filePath);
  }, [isMarkdownFile, preview, filePath]);

  const gutterWidth = useMemo(() => {
    if (!highlightedLines) return 0;
    return lineNumberGutterWidth(highlightedLines.length, theme.fontSize.code);
  }, [highlightedLines, theme.fontSize.code]);
  const lineHeight = theme.fontSize.code * 1.45;
  const lineSelection = useMemo(() => {
    if (!highlightedLines) {
      return null;
    }
    return clampLineSelection({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      lineCount: highlightedLines.length,
    });
  }, [highlightedLines, location.lineEnd, location.lineStart]);

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

  useEffect(() => {
    if (!lineSelection) {
      return;
    }
    const timeout = setTimeout(() => {
      previewScrollRef.current?.scrollTo({
        y: Math.max(0, (lineSelection.lineStart - 1) * lineHeight),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [lineHeight, lineSelection, navigationRevision]);

  if (isLoading && !preview) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>
    );
  }

  if (preview.kind === "text") {
    if (isMarkdownFile) {
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            contentContainerStyle={styles.previewMarkdownScrollContent}
            showsVerticalScrollIndicator
          >
            <MarkdownRenderer text={preview.content ?? ""} />
          </RNScrollView>
        </View>
      );
    }

    const lines = highlightedLines ?? [[{ text: preview.content ?? "", style: null }]];
    const keyedLines = lines.map((tokens, index) => ({
      key: `line-${index}`,
      tokens,
      lineNumber: index + 1,
    }));
    const codeLines = (
      <View dataSet={CODE_SURFACE_DATASET}>
        {keyedLines.map(({ key, tokens, lineNumber }) => (
          <CodeLine
            key={key}
            tokens={tokens}
            lineNumber={lineNumber}
            gutterWidth={gutterWidth}
            highlighted={
              Boolean(lineSelection) &&
              lineNumber >= (lineSelection?.lineStart ?? 0) &&
              lineNumber <= (lineSelection?.lineEnd ?? 0)
            }
          />
        ))}
      </View>
    );

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          showsVerticalScrollIndicator
        >
          {isMobile ? (
            <View style={styles.previewCodeScrollContent}>{codeLines}</View>
          ) : (
            <RNScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.previewCodeScrollContent}
            >
              {codeLines}
            </RNScrollView>
          )}
        </RNScrollView>
      </View>
    );
  }

  if (preview.kind === "image") {
    if (!imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewImageScrollContent}
          showsVerticalScrollIndicator
        >
          <RNImage
            source={imageSource ?? undefined}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </RNScrollView>
      </View>
    );
  }

  return (
    <BinaryFilePreview
      size={preview.size}
      onDownload={onDownloadBinary}
      onReveal={onRevealBinary}
      revealLabel={revealBinaryLabel}
    />
  );
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
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size })}</Text>
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
  const isMobile = useIsCompactFormFactor();
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview");
  const [resolvedPreview, setResolvedPreview] = useState<{
    key: string | null;
    file: ExplorerFile | null;
    imageAttachment: AttachmentMetadata | null;
  }>({ key: null, file: null, imageAttachment: null });

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
  const supportsEditing = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const {
    directoryRelativePath,
    outsideAbsolutePath,
    outsidePathKind,
    browseAbsoluteDirectory,
    readTarget,
  } = useFilePanePathRouting({
    client,
    path: normalizedFilePath,
    workspaceRoot: normalizedWorkspaceRoot,
  });

  // Re-read the file when this pane becomes visible again (#445). `isActive`
  // covers tab switches; active app visibility covers backgrounding and returning
  // from another window after an external edit. The gate lives in isFileQueryEnabled.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const enabled = isFileQueryEnabled({
    hasReadTarget: Boolean(client && readTarget),
    isTabActive: isActive,
    isAppVisible,
  });
  const { query, version } = useLiveFile({
    client,
    serverId,
    cwd: readTarget?.cwd ?? null,
    path: readTarget?.path ?? null,
    enabled,
    liveUpdates: supportsEditing,
  });

  useEffect(() => {
    let active = true;
    const key = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
    void (async () => {
      const nextPreview = await createFilePanePreview(query.data ?? null);
      if (active) setResolvedPreview({ key, ...nextPreview });
    })();
    return () => {
      active = false;
    };
  }, [query.data, readTarget]);

  useEffect(() => setMarkdownMode("preview"), [readTarget?.path]);

  const previewKey = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
  const preview = resolvedPreview.key === previewKey ? resolvedPreview.file : null;
  const imagePreviewUri = useAttachmentPreviewUrl(
    resolvedPreview.key === previewKey ? resolvedPreview.imageAttachment : null,
  );
  const isMarkdown = isMarkdownPreview(preview, location.path);
  const editable = isEditableTextFile({
    preview,
    supportsEditing,
  });
  const lineCount =
    preview?.kind === "text" ? (preview.content ?? "").split("\n").length : undefined;
  const { activeAbsoluteDirectory, recoveredDirectoryPath } = resolveDirectorySurfacePaths({
    directoryRelativePath,
    outsideAbsolutePath,
    browseAbsoluteDirectory,
    directoryLoadError: isNotAFileError(query.error),
    path: normalizedFilePath,
    workspaceRoot: normalizedWorkspaceRoot,
  });

  const directorySurface = useDirectoryFileSurface({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
    activeAbsoluteDirectory,
    outsideAbsolutePath,
    outsidePathKind,
    recoveredDirectoryPath,
  });

  const binaryActions = useBinaryFileActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
    filePath: normalizedFilePath,
  });

  if (directorySurface) {
    return directorySurface;
  }

  return (
    <FilePanePresentation
      serverId={serverId}
      client={client}
      readTarget={readTarget}
      preview={preview}
      version={version}
      filename={getFileNameFromPath(location.path) ?? location.path}
      markdownMode={isMarkdown ? markdownMode : undefined}
      onMarkdownModeChange={isMarkdown ? setMarkdownMode : undefined}
      lineCount={lineCount}
      editable={editable}
      disconnectedMessage={t("workspace.terminal.hostDisconnected")}
      errorMessage={getFileErrorMessage(query.error, t("panels.file.failedToLoad"))}
      isLoading={query.isFetching}
      isMobile={isMobile}
      location={location}
      navigationRevision={navigationRevision}
      imagePreviewUri={imagePreviewUri}
      onDownloadBinary={binaryActions.onDownload}
      onRevealBinary={binaryActions.onReveal}
      revealBinaryLabel={binaryActions.revealLabel}
    />
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
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      </View>
    );
  }

  if (input.recoveredDirectoryPath != null) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState} testID="file-directory-redirect">
          <Text style={styles.emptyText}>{t("panels.file.directoryOpenedInExplorer")}</Text>
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
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const setExpandedPathsForWorkspace = usePanelStore((state) => state.setExpandedPathsForWorkspace);
  const { workspaceStateKey, requestDirectoryListing, selectExplorerEntry } =
    useFileExplorerActions({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
    });

  return useCallback(
    (relativePath: string) => {
      const checkout = {
        serverId: input.serverId,
        cwd: input.workspaceRoot,
        isGit: true,
      };
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
      setExplorerTabForCheckout({ ...checkout, tab: "files" });
      openFileExplorerForCheckout({
        isCompact: isMobile,
        checkout,
      });
    },
    [
      input.serverId,
      input.workspaceRoot,
      isMobile,
      openFileExplorerForCheckout,
      requestDirectoryListing,
      selectExplorerEntry,
      setExpandedPathsForWorkspace,
      setExplorerTabForCheckout,
      workspaceStateKey,
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

function isMarkdownPreview(preview: ExplorerFile | null, path: string): boolean {
  return preview?.kind === "text" && isRenderedMarkdownFile(path);
}

function getFileErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

function isEditableTextFile(input: {
  preview: ExplorerFile | null;
  supportsEditing: boolean;
}): boolean {
  return Boolean(
    isWeb &&
    input.supportsEditing &&
    input.preview?.kind === "text" &&
    input.preview.size <= 1024 * 1024,
  );
}

function FilePanePresentation({
  serverId,
  client,
  readTarget,
  preview,
  version,
  filename,
  markdownMode,
  onMarkdownModeChange,
  lineCount,
  editable,
  disconnectedMessage,
  errorMessage,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  onDownloadBinary,
  onRevealBinary,
  revealBinaryLabel,
}: {
  serverId: string;
  client: DaemonClient | null;
  readTarget: { cwd: string; path: string } | null;
  preview: ExplorerFile | null;
  version: FileVersion | null;
  filename: string;
  markdownMode?: "preview" | "source";
  onMarkdownModeChange?: (mode: "preview" | "source") => void;
  lineCount?: number;
  editable: boolean;
  disconnectedMessage: string;
  errorMessage: string | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  onDownloadBinary?: () => void;
  onRevealBinary?: () => void;
  revealBinaryLabel?: string;
}) {
  if (!client && readTarget) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{disconnectedMessage}</Text>
        </View>
      </View>
    );
  }

  if (editable && client && readTarget && preview?.kind === "text") {
    return (
      <EditableFilePane
        key={`${serverId}:${readTarget.cwd}:${readTarget.path}`}
        client={client}
        cwd={readTarget.cwd}
        path={readTarget.path}
        preview={preview as TextExplorerFile}
        version={version}
        filename={filename}
        mode={markdownMode}
        onModeChange={onMarkdownModeChange}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
      />
    );
  }

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {preview ? (
        <FilePanelBar
          size={preview.size}
          lineCount={lineCount}
          mode={markdownMode}
          onModeChange={onMarkdownModeChange}
        />
      ) : null}
      {errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <FilePreviewBody
        preview={preview}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        imagePreviewUri={imagePreviewUri}
        onDownloadBinary={onDownloadBinary}
        onRevealBinary={onRevealBinary}
        revealBinaryLabel={revealBinaryLabel}
      />
    </View>
  );
}

function EditableFilePane({
  client,
  cwd,
  path,
  preview,
  version,
  filename,
  mode,
  onModeChange,
  isLoading,
  isMobile,
  location,
  navigationRevision,
}: {
  client: DaemonClient;
  cwd: string;
  path: string;
  preview: TextExplorerFile;
  version: FileVersion | null;
  filename: string;
  mode?: "preview" | "source";
  onModeChange?: (mode: "preview" | "source") => void;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [vimMode, setVimMode] = useState<string | null>(settings.vimKeybindings ? "NORMAL" : null);
  const session = useMemo(
    () => ({
      async read(): Promise<FileEditorFile> {
        const file = await client.readFile(cwd, path);
        if (file.kind !== "text") throw new Error("File is no longer text.");
        return {
          content: new TextDecoder().decode(file.bytes),
          version: {
            status: "ready",
            cwd,
            path,
            size: file.size,
            modifiedAt: file.modifiedAt,
            revision: file.revision,
          },
        };
      },
      write(input: { content: string; expectedModifiedAt: string; expectedRevision?: string }) {
        return client.writeFile({ cwd, path, ...input });
      },
    }),
    [client, cwd, path],
  );
  const [model] = useState(
    () =>
      new FileEditorModel({
        file: {
          content: preview.content ?? "",
          version: {
            status: "ready",
            cwd,
            path,
            size: preview.size,
            modifiedAt: preview.modifiedAt,
          },
        },
        session,
      }),
  );
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const suspendPendingSave = useCallback(() => model.suspendAutosave(), [model]);
  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const theme = UnistylesRuntime.getTheme();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.foregroundMuted,
      theme.colors.surface0,
      theme.colors.syntax,
      theme.colors.terminal.cursor,
      theme.colors.terminal.selectionBackground,
      theme.colorScheme,
      theme.fontFamily.mono,
      theme.fontSize.code,
    ],
  );

  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => {
    if (version) model.receiveFileVersion(version);
  }, [model, version]);

  const handleReload = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("panels.file.editor.reloadTitle"),
        message: t("panels.file.editor.reloadMessage"),
        confirmLabel: t("panels.file.editor.reload"),
        destructive: true,
      });
      if (confirmed) void model.reload();
    })();
  }, [model, t]);
  const handleOverwrite = useCallback(() => void model.overwrite(), [model]);
  const handleVimModeChange = useCallback((nextMode: string | null) => setVimMode(nextMode), []);
  const renderedPreview = useMemo<ExplorerFile>(
    () => ({
      ...preview,
      content: snapshot.content,
      size: snapshot.version.status === "ready" ? snapshot.version.size : preview.size,
      modifiedAt:
        snapshot.version.status === "ready" ? snapshot.version.modifiedAt : preview.modifiedAt,
    }),
    [preview, snapshot.content, snapshot.version],
  );
  const showSource = mode !== "preview";

  return (
    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar
        size={
          snapshot.observedVersion.status === "ready" ? snapshot.observedVersion.size : preview.size
        }
        lineCount={snapshot.content.split("\n").length}
        editorStatus={snapshot.status}
        cursor={showSource ? cursor : undefined}
        vimMode={showSource ? vimMode : null}
        conflictUnavailable={snapshot.observedVersion.status !== "ready"}
        onOverwrite={handleOverwrite}
        onReload={handleReload}
        mode={mode}
        onModeChange={onModeChange}
      />
      {showSource ? (
        <FileEditorView
          model={model}
          filename={filename}
          location={location}
          navigationRevision={navigationRevision}
          vimEnabled={settings.vimKeybindings}
          theme={visualTheme}
          onCursorChange={setCursor}
          onVimModeChange={handleVimModeChange}
        />
      ) : (
        <FilePreviewBody
          preview={renderedPreview}
          isLoading={isLoading}
          isMobile={isMobile}
          location={location}
          navigationRevision={navigationRevision}
          imagePreviewUri={null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  binaryActions: {
    marginTop: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "center",
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
  previewMarkdownScrollContent: {
    padding: theme.spacing[4],
  },
  previewImageScrollContent: {
    flexGrow: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 420,
  },
}));
