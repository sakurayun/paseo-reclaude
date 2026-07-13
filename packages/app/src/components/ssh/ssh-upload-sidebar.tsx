import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Folder,
  Trash2,
  Upload,
  X,
} from "lucide-react-native";
import type { SshUpload, SshUploadFile } from "@getpaseo/protocol/messages";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
import { formatByteSize } from "@/components/ssh/ssh-upload-drop-sheet";
import { getFileIconSvg } from "@/components/material-file-icons";
import { TreeChevron, treeRowPaddingLeft } from "@/components/tree-primitives";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import {
  buildFileTree,
  flattenFileTree,
  type FileTreeDir,
  type FileTreeNode,
} from "@/git/commit-file-tree";
import { useHostTerminals } from "@/hooks/use-host-terminals";
import { useSshHosts } from "@/screens/ssh/use-ssh-hosts";
import { useSessionStore } from "@/stores/session-store";
import { useSshTerminalMetaStore } from "@/stores/ssh-terminal-meta-store";
import {
  useSshUploads,
  useSshUploadStore,
  type SshUploadFileProgress,
} from "@/stores/ssh-upload-store";
import { buildRemoteCdCommand, joinRemotePath, remoteParentDir } from "@/ssh/upload/remote-path";
import { useSshUploadsSync } from "@/ssh/upload/use-ssh-uploads-sync";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { isSyntheticTerminalWorkspaceId } from "@/utils/terminal-workspace-id";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";

const SIDEBAR_WIDTH = 300;
const ROW_ICON_SIZE = 16;

const MutedX = withUnistyles(X, (theme) => ({ color: theme.colors.foregroundMuted }));
const MutedStop = withUnistyles(CircleStop, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const MutedTrash = withUnistyles(Trash2, (theme) => ({ color: theme.colors.foregroundMuted }));
const MutedFolder = withUnistyles(Folder, (theme) => ({ color: theme.colors.foregroundMuted }));
const MutedBan = withUnistyles(Ban, (theme) => ({ color: theme.colors.foregroundMuted }));
const GreenCheck = withUnistyles(CircleCheck, (theme) => ({
  color: theme.colors.palette.green[500],
}));
const RedAlert = withUnistyles(CircleAlert, (theme) => ({
  color: theme.colors.palette.red[500],
}));
const AccentUpload = withUnistyles(Upload, (theme) => ({ color: theme.colors.foreground }));

interface UploadTreeFile extends SshUploadFile {
  path: string;
}

type PanelRow =
  | { key: string; kind: "upload"; upload: SshUpload }
  | {
      key: string;
      kind: "node";
      upload: SshUpload;
      node: FileTreeNode<UploadTreeFile>;
      depth: number;
    };

function collectTreeFiles(node: FileTreeNode<UploadTreeFile>): UploadTreeFile[] {
  if (node.kind === "file") {
    return [node.file];
  }
  return node.children.flatMap(collectTreeFiles);
}

function isFileSettled(status: SshUploadFile["status"]): boolean {
  return status === "done" || status === "error" || status === "canceled";
}

function mergedWrittenBytes(
  file: SshUploadFile,
  progress: Record<string, SshUploadFileProgress> | undefined,
): number {
  const live = progress?.[file.id]?.bytesWritten ?? 0;
  return Math.max(file.bytesWritten, live);
}

// Finds the terminal to run the jump-cd in: the drop terminal if still alive,
// else any live SSH terminal on the upload's host.
function useJumpToRemoteDir(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const { terminals } = useHostTerminals(serverId);
  const metaByTerminalId = useSshTerminalMetaStore((state) => state.metaByTerminalId);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const { hosts } = useSshHosts(serverId);

  return useCallback(
    async (upload: SshUpload, dir: string) => {
      if (!client) {
        return;
      }
      const live = terminals.filter(
        (terminal) =>
          terminal.status !== "exited" && metaByTerminalId[terminal.id]?.hostId === upload.hostId,
      );
      const target = live.find((terminal) => terminal.id === upload.terminalId) ?? live[0];
      if (!target) {
        toast.error(t("ssh.uploads.jump.noTerminal"));
        return;
      }
      // Best-effort busy guard: the activity tracker marks recent terminal
      // input as working; there is no reliable remote foreground-job signal.
      if (deriveTerminalActivityStatusBucket(target.activity) === "running") {
        const confirmed = await confirmDialog({
          title: t("ssh.uploads.jump.busyTitle"),
          message: t("ssh.uploads.jump.busyMessage"),
          confirmLabel: t("ssh.uploads.jump.busyConfirm"),
          cancelLabel: t("workspace.tabs.confirmations.cancel"),
        });
        if (!confirmed) {
          return;
        }
      }
      const os = hosts.find((host) => host.id === upload.hostId)?.platform?.os ?? null;
      client.sendTerminalInput(target.id, {
        type: "input",
        data: buildRemoteCdCommand(dir, os),
      });
      const workspaceId =
        target.workspaceId && !isSyntheticTerminalWorkspaceId(target.workspaceId)
          ? target.workspaceId
          : null;
      if (workspaceId) {
        navigateToPreparedWorkspaceTab({
          serverId,
          workspaceId,
          target: { kind: "terminal", terminalId: target.id },
        });
      }
    },
    [client, hosts, metaByTerminalId, serverId, t, terminals, toast],
  );
}

// Mounts the uploads mirror sync and shows either the pinned panel or, when
// the panel is closed but uploads exist, a floating reopen pill. Renders
// nothing on daemons without the sshUploads capability.
export function SshUploadSidebarHost({ serverId }: { serverId: string }) {
  const { enabled } = useSshUploadsSync(serverId);
  const panelOpen = useSshUploadStore((state) => state.panelOpen);
  const openPanel = useSshUploadStore((state) => state.openPanel);
  const uploads = useSshUploads(serverId);
  const { t } = useTranslation();

  if (!enabled) {
    return null;
  }
  if (panelOpen) {
    return <SshUploadSidebar serverId={serverId} uploads={uploads} />;
  }
  if (uploads.length === 0) {
    return null;
  }
  const activeCount = uploads.filter((upload) => upload.status === "active").length;
  return (
    <Pressable
      style={styles.floatingPill}
      onPress={openPanel}
      accessibilityRole="button"
      accessibilityLabel={t("ssh.uploads.panel.title")}
      testID="ssh-upload-floating-pill"
    >
      <AccentUpload size={14} />
      <Text style={styles.floatingPillText}>
        {activeCount > 0
          ? t("ssh.uploads.panel.pillActive", { count: activeCount })
          : t("ssh.uploads.panel.pillIdle", { count: uploads.length })}
      </Text>
    </Pressable>
  );
}

function SshUploadSidebar({ serverId, uploads }: { serverId: string; uploads: SshUpload[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const closePanel = useSshUploadStore((state) => state.closePanel);
  const collapsedDirs = useSshUploadStore((state) => state.collapsedDirs);
  const toggleCollapsedDir = useSshUploadStore((state) => state.toggleCollapsedDir);
  const progressByUpload = useSshUploadStore((state) => state.progressByUpload);
  const jumpToRemoteDir = useJumpToRemoteDir(serverId);

  const rows = useMemo<PanelRow[]>(() => {
    const built: PanelRow[] = [];
    for (const upload of uploads) {
      built.push({ key: `u:${upload.uploadId}`, kind: "upload", upload });
      const treeFiles: UploadTreeFile[] = upload.files.map((file) => ({
        ...file,
        path: file.relativePath,
      }));
      const collapsed = new Set<string>();
      for (const [key, value] of Object.entries(collapsedDirs)) {
        if (value && key.startsWith(`${upload.uploadId}:`)) {
          collapsed.add(key.slice(upload.uploadId.length + 1));
        }
      }
      for (const row of flattenFileTree(buildFileTree(treeFiles), collapsed)) {
        const nodeKey =
          row.node.kind === "dir"
            ? `n:${upload.uploadId}:${row.node.path}`
            : `n:${upload.uploadId}:${row.node.file.path}`;
        built.push({ key: nodeKey, kind: "node", upload, node: row.node, depth: row.depth });
      }
    }
    return built;
  }, [collapsedDirs, uploads]);

  const hasActive = uploads.some((upload) => upload.status === "active");
  const hasFinished = uploads.some((upload) => upload.status !== "active");

  const handleStopAll = useCallback(() => {
    if (!client) {
      return;
    }
    for (const upload of uploads) {
      if (upload.status === "active") {
        void client.cancelSshUpload({ uploadId: upload.uploadId }).catch(() => undefined);
      }
    }
  }, [client, uploads]);

  const handleClearFinished = useCallback(() => {
    void client?.clearSshUploads({}).catch(() => undefined);
  }, [client]);

  const handleCancelFiles = useCallback(
    (uploadId: string, fileIds?: string[]) => {
      void client
        ?.cancelSshUpload({ uploadId, ...(fileIds ? { fileIds } : {}) })
        .catch(() => undefined);
    },
    [client],
  );

  const handleCopyRemotePath = useCallback(
    (upload: SshUpload, relativePath: string) => {
      void copyToClipboard(joinRemotePath(upload.destDir, relativePath)).then(() => toast.copied());
    },
    [toast],
  );

  const handleJump = useCallback(
    (upload: SshUpload, relativeDir: string | null) => {
      const dir =
        relativeDir === null ? upload.destDir : joinRemotePath(upload.destDir, relativeDir);
      void jumpToRemoteDir(upload, dir);
    },
    [jumpToRemoteDir],
  );

  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<PanelRow>) => {
      if (item.kind === "upload") {
        return (
          <UploadHeaderRow
            upload={item.upload}
            progress={progressByUpload[item.upload.uploadId]}
            onCancelUpload={handleCancelFiles}
            onJump={handleJump}
          />
        );
      }
      if (item.node.kind === "dir") {
        return (
          <UploadDirRow
            upload={item.upload}
            dir={item.node}
            depth={item.depth}
            collapsed={Boolean(collapsedDirs[`${item.upload.uploadId}:${item.node.path}`])}
            onToggle={toggleCollapsedDir}
            onCancelFiles={handleCancelFiles}
            onJump={handleJump}
            onCopyRemotePath={handleCopyRemotePath}
          />
        );
      }
      return (
        <UploadFileRow
          upload={item.upload}
          file={item.node.file}
          name={item.node.name}
          depth={item.depth}
          progress={progressByUpload[item.upload.uploadId]}
          onCancelFiles={handleCancelFiles}
          onJump={handleJump}
          onCopyRemotePath={handleCopyRemotePath}
        />
      );
    },
    [
      collapsedDirs,
      handleCancelFiles,
      handleCopyRemotePath,
      handleJump,
      progressByUpload,
      toggleCollapsedDir,
    ],
  );

  return (
    <View style={styles.container} testID="ssh-upload-sidebar">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("ssh.uploads.panel.title")}</Text>
        <View style={styles.headerActions}>
          {hasActive ? (
            <Pressable
              style={styles.headerButton}
              onPress={handleStopAll}
              accessibilityRole="button"
              accessibilityLabel={t("ssh.uploads.panel.stopAll")}
              testID="ssh-upload-stop-all"
            >
              <MutedStop size={ROW_ICON_SIZE} />
            </Pressable>
          ) : null}
          {hasFinished ? (
            <Pressable
              style={styles.headerButton}
              onPress={handleClearFinished}
              accessibilityRole="button"
              accessibilityLabel={t("ssh.uploads.panel.clearFinished")}
              testID="ssh-upload-clear-finished"
            >
              <MutedTrash size={ROW_ICON_SIZE} />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.headerButton}
            onPress={closePanel}
            accessibilityRole="button"
            accessibilityLabel={t("ssh.uploads.panel.close")}
            testID="ssh-upload-close-panel"
          >
            <MutedX size={ROW_ICON_SIZE} />
          </Pressable>
        </View>
      </View>
      {rows.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t("ssh.uploads.panel.empty")}</Text>
        </View>
      ) : (
        <FlatList data={rows} renderItem={renderRow} keyExtractor={keyExtractor} />
      )}
    </View>
  );
}

function keyExtractor(item: PanelRow): string {
  return item.key;
}

function UploadHeaderRow({
  upload,
  progress,
  onCancelUpload,
  onJump,
}: {
  upload: SshUpload;
  progress: Record<string, SshUploadFileProgress> | undefined;
  onCancelUpload: (uploadId: string) => void;
  onJump: (upload: SshUpload, relativeDir: string | null) => void;
}) {
  const { t } = useTranslation();
  const totalSize = upload.files.reduce((sum, file) => sum + file.size, 0);
  const written = upload.files.reduce((sum, file) => sum + mergedWrittenBytes(file, progress), 0);
  const percent = totalSize > 0 ? Math.min(100, Math.round((written / totalSize) * 100)) : 100;
  const statusLabel =
    upload.status === "active"
      ? t("ssh.uploads.panel.statusActive", { percent })
      : t(`ssh.uploads.panel.status.${upload.status}`);
  const handleCancel = useCallback(
    () => onCancelUpload(upload.uploadId),
    [onCancelUpload, upload.uploadId],
  );
  const handleJumpRoot = useCallback(() => onJump(upload, null), [onJump, upload]);
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${percent}%` as const }],
    [percent],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={styles.uploadHeader}
        testID={`ssh-upload-header-${upload.uploadId}`}
      >
        <View style={styles.uploadHeaderText}>
          <Text style={styles.uploadHeaderTitle} numberOfLines={1}>
            {upload.hostLabel ?? upload.hostId}
          </Text>
          <Text style={styles.uploadHeaderSubtitle} numberOfLines={1}>
            {upload.destDir} · {statusLabel} · {formatByteSize(totalSize)}
          </Text>
          {upload.status === "active" ? (
            <View style={styles.progressTrack}>
              <View style={fillStyle} />
            </View>
          ) : null}
        </View>
        {upload.status === "active" ? (
          <Pressable
            style={styles.headerButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel={t("ssh.uploads.menu.cancelUpload")}
            testID={`ssh-upload-cancel-${upload.uploadId}`}
          >
            <MutedStop size={ROW_ICON_SIZE} />
          </Pressable>
        ) : null}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleJumpRoot}>{t("ssh.uploads.menu.jumpDir")}</ContextMenuItem>
        {upload.status === "active" ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={handleCancel}>
              {t("ssh.uploads.menu.cancelUpload")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function UploadDirRow({
  upload,
  dir,
  depth,
  collapsed,
  onToggle,
  onCancelFiles,
  onJump,
  onCopyRemotePath,
}: {
  upload: SshUpload;
  dir: FileTreeDir<UploadTreeFile>;
  depth: number;
  collapsed: boolean;
  onToggle: (key: string) => void;
  onCancelFiles: (uploadId: string, fileIds?: string[]) => void;
  onJump: (upload: SshUpload, relativeDir: string | null) => void;
  onCopyRemotePath: (upload: SshUpload, relativePath: string) => void;
}) {
  const { t } = useTranslation();
  const subtreeFiles = useMemo(() => collectTreeFiles(dir), [dir]);
  const activeFileIds = subtreeFiles
    .filter((file) => !isFileSettled(file.status))
    .map((file) => file.id);
  const handleToggle = useCallback(
    () => onToggle(`${upload.uploadId}:${dir.path}`),
    [dir.path, onToggle, upload.uploadId],
  );
  const handleJump = useCallback(() => onJump(upload, dir.path), [dir.path, onJump, upload]);
  const handleCopy = useCallback(
    () => onCopyRemotePath(upload, dir.path),
    [dir.path, onCopyRemotePath, upload],
  );
  const handleCancelDir = useCallback(
    () => onCancelFiles(upload.uploadId, activeFileIds),
    [activeFileIds, onCancelFiles, upload.uploadId],
  );
  const rowStyle = useMemo(
    () => [styles.treeRow, { paddingLeft: treeRowPaddingLeft(depth) }],
    [depth],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={rowStyle}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={dir.name}
        testID={`ssh-upload-dir-${upload.uploadId}-${dir.path}`}
      >
        <TreeChevron expanded={!collapsed} />
        <MutedFolder size={ROW_ICON_SIZE} />
        <Text style={styles.rowName} numberOfLines={1}>
          {dir.name}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleJump}>{t("ssh.uploads.menu.jumpDir")}</ContextMenuItem>
        <ContextMenuItem onSelect={handleCopy}>
          {t("ssh.uploads.menu.copyRemotePath")}
        </ContextMenuItem>
        {activeFileIds.length > 0 ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={handleCancelDir}>
              {t("ssh.uploads.menu.cancelDir", { count: activeFileIds.length })}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function UploadFileRow({
  upload,
  file,
  name,
  depth,
  progress,
  onCancelFiles,
  onJump,
  onCopyRemotePath,
}: {
  upload: SshUpload;
  file: UploadTreeFile;
  name: string;
  depth: number;
  progress: Record<string, SshUploadFileProgress> | undefined;
  onCancelFiles: (uploadId: string, fileIds?: string[]) => void;
  onJump: (upload: SshUpload, relativeDir: string | null) => void;
  onCopyRemotePath: (upload: SshUpload, relativePath: string) => void;
}) {
  const { t } = useTranslation();
  const written = mergedWrittenBytes(file, progress);
  const percent = file.size > 0 ? Math.min(100, Math.round((written / file.size) * 100)) : 100;
  const parentDir = remoteParentDir(file.path);
  const handleJump = useCallback(
    () => onJump(upload, parentDir === "." ? null : parentDir),
    [onJump, parentDir, upload],
  );
  const handleCopy = useCallback(
    () => onCopyRemotePath(upload, file.path),
    [file.path, onCopyRemotePath, upload],
  );
  const handleCancel = useCallback(
    () => onCancelFiles(upload.uploadId, [file.id]),
    [file.id, onCancelFiles, upload.uploadId],
  );
  const rowStyle = useMemo(
    () => [styles.treeRow, { paddingLeft: treeRowPaddingLeft(depth) }],
    [depth],
  );
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${percent}%` as const }],
    [percent],
  );
  const iconXml = useMemo(() => getFileIconSvg(name), [name]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={rowStyle}
        accessibilityRole="button"
        accessibilityLabel={name}
        testID={`ssh-upload-file-${upload.uploadId}-${file.path}`}
      >
        <SvgXml xml={iconXml} width={ROW_ICON_SIZE} height={ROW_ICON_SIZE} />
        <View style={styles.fileBody}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {file.status === "uploading" || file.status === "pending" ? (
            <View style={styles.progressTrack}>
              <View style={fillStyle} />
            </View>
          ) : null}
        </View>
        <FileStatusGlyph status={file.status} percent={percent} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleJump}>{t("ssh.uploads.menu.jumpFile")}</ContextMenuItem>
        <ContextMenuItem onSelect={handleCopy}>
          {t("ssh.uploads.menu.copyRemotePath")}
        </ContextMenuItem>
        {!isFileSettled(file.status) ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={handleCancel}>
              {t("ssh.uploads.menu.cancelFile")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileStatusGlyph({
  status,
  percent,
}: {
  status: SshUploadFile["status"];
  percent: number;
}) {
  if (status === "done") {
    return <GreenCheck size={ROW_ICON_SIZE} />;
  }
  if (status === "error") {
    return <RedAlert size={ROW_ICON_SIZE} />;
  }
  if (status === "canceled") {
    return <MutedBan size={ROW_ICON_SIZE} />;
  }
  return <Text style={styles.percentText}>{percent}%</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: SIDEBAR_WIDTH,
    minHeight: 0,
    borderLeftWidth: theme.shell.chromeDivider,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.shell.chromeDivider,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  headerButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  uploadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  uploadHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  uploadHeaderTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  uploadHeaderSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    minHeight: 26,
  },
  fileBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  percentText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: theme.colors.palette.blue[500],
  },
  floatingPill: {
    position: "absolute",
    right: theme.spacing[4],
    bottom: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  floatingPillText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
