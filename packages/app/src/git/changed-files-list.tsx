import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import type { CheckoutGitStatusFile } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { getFileIconSvg } from "@/components/material-file-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useSessionStore } from "@/stores/session-store";
import {
  hasDesktopOpenTargetsBridge,
  listDesktopOpenTargets,
  openDesktopTarget,
} from "@/workspace/desktop-open-targets";
import { useCheckoutGitActionsStore } from "./actions-store";
import {
  buildFileTree,
  flattenFileTree,
  type FileTreeDir,
  type FileTreeNode,
  type FileTreeRow,
} from "./commit-file-tree";
import { clampChangesPanelHeight, useChangesPanelStore } from "./changes-panel-store";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const TREE_INDENT = 12;
const FILE_ICON_SIZE = 14;

type ChangeGroup = "staged" | "unstaged";

type BatchAction =
  | "stage"
  | "unstage"
  | "ignore"
  | "discard"
  | "stash"
  | "copy-patch"
  | "copy-paths";

interface ChangesSelection {
  group: ChangeGroup;
  paths: ReadonlySet<string>;
}

const EMPTY_SELECTION: ChangesSelection = { group: "unstaged", paths: new Set() };

/**
 * Fixed-height, user-resizable container for the changed files tree. The grab
 * handle sits at the very top edge (above the section header); the height is
 * remembered across sessions. Height updates go through an RN Animated value
 * so per-frame drags never touch the Unistyles web stylesheet
 * (docs/unistyles.md).
 */
export function ResizableChangesArea({
  header,
  children,
}: PropsWithChildren<{ header?: ReactNode }>) {
  const storedHeight = useChangesPanelStore((s) => s.height);
  const setHeight = useChangesPanelStore((s) => s.setHeight);
  const heightAnim = useRef(new RNAnimated.Value(storedHeight)).current;
  const currentHeightRef = useRef(storedHeight);
  const dragStartRef = useRef(storedHeight);
  const setHeightRef = useRef(setHeight);
  setHeightRef.current = setHeight;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        dragStartRef.current = currentHeightRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        // The handle sits on the top edge: dragging up grows the area.
        const next = clampChangesPanelHeight(dragStartRef.current - gesture.dy);
        currentHeightRef.current = next;
        heightAnim.setValue(next);
      },
      onPanResponderRelease: () => {
        setHeightRef.current(currentHeightRef.current);
      },
      onPanResponderTerminate: () => {
        setHeightRef.current(currentHeightRef.current);
      },
    }),
  ).current;

  const areaStyle = useMemo(() => [resizeStaticStyles.area, { height: heightAnim }], [heightAnim]);

  // Themed overlay scrollbar, consistent with the rest of the app's panes.
  const scrollRef = useRef<ScrollView>(null);
  const scrollbar = useWebScrollViewScrollbar(scrollRef);

  return (
    <View>
      <View
        style={resizeStaticStyles.handleArea}
        {...panResponder.panHandlers}
        testID="source-control-changes-resize-handle"
      >
        <View style={resizeStaticStyles.handleBar} />
      </View>
      {header}
      <RNAnimated.View style={areaStyle}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          onScroll={scrollbar.onScroll}
          onLayout={scrollbar.onLayout}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
        {scrollbar.overlay}
      </RNAnimated.View>
    </View>
  );
}

// Static styles for the resizable area — the animated height must never run
// through Unistyles (per-frame values would grow the web stylesheet).
const resizeStaticStyles = RNStyleSheet.create({
  area: {
    overflow: "hidden",
  },
  handleArea: {
    height: 10,
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  handleBar: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(127, 127, 127, 0.45)",
  },
});

interface ChangedFilesListProps {
  serverId: string;
  cwd: string;
  stagedFiles: CheckoutGitStatusFile[];
  unstagedFiles: CheckoutGitStatusFile[];
  isLoading: boolean;
  isError: boolean;
  /** Open a plain file preview tab. */
  onOpenFile?: (filePath: string) => void;
  /** Open a single-file diff preview tab (plain click on a file row). */
  onOpenDiffFile?: (filePath: string) => void;
}

/**
 * VSCode-style working tree list under the Changes header, rendered as a
 * collapsible file tree with material icons and per-file +/− line counts.
 * Files are selected by click (Ctrl/Cmd toggles, plain click replaces) and
 * acted on through a right-click (long-press on native) context menu, so a
 * stray click can't trigger a git operation. Directories get their own
 * context menu acting on the whole subtree.
 */
export function ChangedFilesList({
  serverId,
  cwd,
  stagedFiles,
  unstagedFiles,
  isLoading,
  isError,
  onOpenFile,
  onOpenDiffFile,
}: ChangedFilesListProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const gitOp = useCheckoutGitActionsStore((s) => s.gitOp);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<ChangesSelection>(EMPTY_SELECTION);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const handleToggleDir = useCallback((collapseKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(collapseKey)) {
        next.delete(collapseKey);
      } else {
        next.add(collapseKey);
      }
      return next;
    });
  }, []);

  /**
   * Select one or more paths (a directory selects its whole subtree). With
   * additive (Ctrl/Cmd) the set toggles: fully-selected paths deselect,
   * anything else joins the selection.
   */
  const handleSelectPaths = useCallback(
    (group: ChangeGroup, paths: string[], additive: boolean) => {
      if (paths.length === 0) {
        return;
      }
      setSelection((current) => {
        if (!additive || current.group !== group) {
          return { group, paths: new Set(paths) };
        }
        const next = new Set(current.paths);
        const allSelected = paths.every((path) => next.has(path));
        for (const path of paths) {
          if (allSelected) {
            next.delete(path);
          } else {
            next.add(path);
          }
        }
        return { group, paths: next };
      });
    },
    [],
  );

  /** Right-click on unselected rows retargets the selection to them. */
  const handleEnsurePathsSelected = useCallback((group: ChangeGroup, paths: string[]) => {
    if (paths.length === 0) {
      return;
    }
    setSelection((current) =>
      current.group === group && paths.every((path) => current.paths.has(path))
        ? current
        : { group, paths: new Set(paths) },
    );
  }, []);

  const filesByPath = useMemo(() => {
    const map = new Map<string, CheckoutGitStatusFile>();
    for (const file of [...stagedFiles, ...unstagedFiles]) {
      map.set(file.path, file);
    }
    return map;
  }, [stagedFiles, unstagedFiles]);

  const runPathsOp = useCallback(
    (
      op:
        | "stage-paths"
        | "unstage-paths"
        | "discard-paths"
        | "clean-paths"
        | "ignore-paths"
        | "stash-paths",
      paths: string[],
    ) => {
      if (paths.length === 0) {
        return;
      }
      void gitOp({ serverId, cwd, op, paths }).catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.sourceControl.menu.opFailed"),
        );
      });
    },
    [cwd, gitOp, serverId, t, toast],
  );

  /** Batch actions apply to the whole current selection. */
  const handleBatchAction = useCallback(
    (action: BatchAction) => {
      const current = selectionRef.current;
      const paths = [...current.paths];
      if (paths.length === 0) {
        return;
      }
      if (action === "stage") {
        runPathsOp("stage-paths", paths);
        return;
      }
      if (action === "unstage") {
        runPathsOp("unstage-paths", paths);
        return;
      }
      if (action === "ignore") {
        runPathsOp("ignore-paths", paths);
        return;
      }
      if (action === "stash") {
        runPathsOp("stash-paths", paths);
        return;
      }
      if (action === "copy-paths") {
        void Clipboard.setStringAsync(paths.join("\n")).then(() => {
          toast.show(t("workspace.sourceControl.changes.copiedPath"), { variant: "success" });
          return;
        });
        return;
      }
      if (action === "copy-patch") {
        const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
        if (!client) {
          toast.error(t("common.errors.daemonClientUnavailable"));
          return;
        }
        void client
          .checkoutGitOp(cwd, { op: "diff-paths", paths })
          .then(async (payload) => {
            if (payload.error) {
              throw new Error(payload.error.message);
            }
            await Clipboard.setStringAsync(payload.output ?? "");
            toast.show(t("workspace.sourceControl.changes.copiedPatch"), { variant: "success" });
            return;
          })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : t("workspace.sourceControl.menu.opFailed"),
            );
          });
        return;
      }
      // Discard splits by tracked-ness: tracked restore from HEAD, untracked
      // are deleted via git clean.
      const tracked: string[] = [];
      const untracked: string[] = [];
      for (const path of paths) {
        if (filesByPath.get(path)?.indexStatus === "?") {
          untracked.push(path);
        } else {
          tracked.push(path);
        }
      }
      void confirmDialog({
        title: t("workspace.sourceControl.changes.discardSelectedConfirmTitle", {
          count: paths.length,
        }),
        message: t("workspace.sourceControl.changes.discardConfirmMessage"),
        confirmLabel: t("workspace.sourceControl.menu.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then((confirmed) => {
        if (!confirmed) {
          return;
        }
        runPathsOp("discard-paths", tracked);
        runPathsOp("clean-paths", untracked);
        return;
      });
    },
    [cwd, filesByPath, runPathsOp, serverId, t, toast],
  );

  /** Reveal in the OS file manager (desktop bridge only, local checkouts). */
  const handleReveal = useCallback(
    (path: string) => {
      void (async () => {
        const targets = await listDesktopOpenTargets();
        const fileManager = targets.find((target) => target.kind === "file-manager");
        if (!fileManager) {
          toast.error(t("workspace.sourceControl.menu.opFailed"));
          return;
        }
        await openDesktopTarget({
          editorId: fileManager.id,
          path: `${cwd}/${path}`,
          cwd,
          mode: "reveal",
        });
      })().catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.sourceControl.menu.opFailed"),
        );
      });
    },
    [cwd, t, toast],
  );
  const canReveal = hasDesktopOpenTargetsBridge();

  const stagedRows = useMemo(
    () => flattenFileTree(buildFileTree(stagedFiles), prefixedSet(collapsed, "staged")),
    [stagedFiles, collapsed],
  );
  const unstagedRows = useMemo(
    () => flattenFileTree(buildFileTree(unstagedFiles), prefixedSet(collapsed, "unstaged")),
    [unstagedFiles, collapsed],
  );

  if (isLoading) {
    return (
      <View style={styles.stateRow}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (isError) {
    return <Text style={styles.stateText}>{t("workspace.sourceControl.changes.filesError")}</Text>;
  }
  if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
    return <Text style={styles.stateText}>{t("workspace.sourceControl.changes.filesEmpty")}</Text>;
  }

  const showGroups = stagedFiles.length > 0;
  const selectionCount = selection.paths.size;
  return (
    <View>
      {showGroups ? (
        <Text style={styles.groupTitle}>
          {t("workspace.sourceControl.changes.stagedTitle")} · {stagedFiles.length}
        </Text>
      ) : null}
      {stagedRows.map((row) => (
        <ChangedTreeRow
          key={`staged-${rowKey(row)}`}
          row={row}
          group="staged"
          dirCollapsed={row.node.kind === "dir" && collapsed.has(`staged:${row.node.path}`)}
          selected={isRowSelected(row.node, "staged", selection)}
          selectionCount={selection.group === "staged" ? selectionCount : 0}
          onToggleDir={handleToggleDir}
          onSelectPaths={handleSelectPaths}
          onEnsurePathsSelected={handleEnsurePathsSelected}
          onBatchAction={handleBatchAction}
          onOpenFile={onOpenFile}
          onOpenDiffFile={onOpenDiffFile}
          canReveal={canReveal}
          onReveal={handleReveal}
        />
      ))}
      {showGroups && unstagedFiles.length > 0 ? (
        <Text style={styles.groupTitle}>
          {t("workspace.sourceControl.changes.unstagedTitle")} · {unstagedFiles.length}
        </Text>
      ) : null}
      {unstagedRows.map((row) => (
        <ChangedTreeRow
          key={`unstaged-${rowKey(row)}`}
          row={row}
          group="unstaged"
          dirCollapsed={row.node.kind === "dir" && collapsed.has(`unstaged:${row.node.path}`)}
          selected={isRowSelected(row.node, "unstaged", selection)}
          selectionCount={selection.group === "unstaged" ? selectionCount : 0}
          onToggleDir={handleToggleDir}
          onSelectPaths={handleSelectPaths}
          onEnsurePathsSelected={handleEnsurePathsSelected}
          onBatchAction={handleBatchAction}
          onOpenFile={onOpenFile}
          onOpenDiffFile={onOpenDiffFile}
          canReveal={canReveal}
          onReveal={handleReveal}
        />
      ))}
    </View>
  );
}

function rowKey(row: FileTreeRow<CheckoutGitStatusFile>): string {
  return row.node.kind === "dir" ? `dir-${row.node.path}` : `file-${row.node.file.path}`;
}

/** Collapse keys are group-prefixed so both trees share one state set. */
function prefixedSet(collapsed: ReadonlySet<string>, group: string): ReadonlySet<string> {
  const result = new Set<string>();
  for (const key of collapsed) {
    if (key.startsWith(`${group}:`)) {
      result.add(key.slice(group.length + 1));
    }
  }
  return result;
}

function statusLetter(file: CheckoutGitStatusFile, staged: boolean): string {
  const letter = staged ? file.indexStatus : file.worktreeStatus;
  return letter === "?" ? "U" : letter;
}

/** All file paths under a tree node (the node itself for leaves). */
function collectFilePaths(node: FileTreeNode<CheckoutGitStatusFile>): string[] {
  if (node.kind === "file") {
    return [node.file.path];
  }
  return node.children.flatMap(collectFilePaths);
}

/** A row is selected when all of its subtree paths are in the selection. */
function isRowSelected(
  node: FileTreeNode<CheckoutGitStatusFile>,
  group: ChangeGroup,
  selection: ChangesSelection,
): boolean {
  if (selection.group !== group) {
    return false;
  }
  const paths = collectFilePaths(node);
  return paths.length > 0 && paths.every((path) => selection.paths.has(path));
}

function isAdditiveSelectEvent(event: GestureResponderEvent): boolean {
  const native = event.nativeEvent as { ctrlKey?: boolean; metaKey?: boolean };
  return native.ctrlKey === true || native.metaKey === true;
}

function ChangedTreeRow({
  row,
  group,
  dirCollapsed,
  selected,
  selectionCount,
  onToggleDir,
  onSelectPaths,
  onEnsurePathsSelected,
  onBatchAction,
  onOpenFile,
  onOpenDiffFile,
  canReveal,
  onReveal,
}: {
  row: FileTreeRow<CheckoutGitStatusFile>;
  group: ChangeGroup;
  dirCollapsed: boolean;
  selected: boolean;
  selectionCount: number;
  onToggleDir: (collapseKey: string) => void;
  onSelectPaths: (group: ChangeGroup, paths: string[], additive: boolean) => void;
  onEnsurePathsSelected: (group: ChangeGroup, paths: string[]) => void;
  onBatchAction: (action: BatchAction) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDiffFile?: (filePath: string) => void;
  canReveal: boolean;
  onReveal: (path: string) => void;
}) {
  const node = row.node;
  if (node.kind === "dir") {
    return (
      <ChangedDirRow
        dir={node}
        depth={row.depth}
        group={group}
        collapsed={dirCollapsed}
        selected={selected}
        selectionCount={selectionCount}
        onToggleDir={onToggleDir}
        onSelectPaths={onSelectPaths}
        onEnsurePathsSelected={onEnsurePathsSelected}
        onBatchAction={onBatchAction}
        canReveal={canReveal}
        onReveal={onReveal}
      />
    );
  }
  return (
    <ChangedFileRow
      name={node.name}
      file={node.file}
      depth={row.depth}
      group={group}
      selected={selected}
      selectionCount={selectionCount}
      onSelectPaths={onSelectPaths}
      onEnsurePathsSelected={onEnsurePathsSelected}
      onBatchAction={onBatchAction}
      onOpenFile={onOpenFile}
      onOpenDiffFile={onOpenDiffFile}
      canReveal={canReveal}
      onReveal={onReveal}
    />
  );
}

/** Shared context-menu items acting on the current selection. */
function BatchMenuItems({
  group,
  count,
  onBatchAction,
}: {
  group: ChangeGroup;
  count: number;
  onBatchAction: (action: BatchAction) => void;
}) {
  const { t } = useTranslation();
  const handleStage = useCallback(() => onBatchAction("stage"), [onBatchAction]);
  const handleUnstage = useCallback(() => onBatchAction("unstage"), [onBatchAction]);
  const handleDiscard = useCallback(() => onBatchAction("discard"), [onBatchAction]);
  const handleIgnore = useCallback(() => onBatchAction("ignore"), [onBatchAction]);
  const handleStash = useCallback(() => onBatchAction("stash"), [onBatchAction]);

  if (group === "staged") {
    return (
      <ContextMenuItem onSelect={handleUnstage}>
        {t("workspace.sourceControl.changes.unstageSelected", { count })}
      </ContextMenuItem>
    );
  }
  return (
    <>
      <ContextMenuItem onSelect={handleStage}>
        {t("workspace.sourceControl.changes.stageSelected", { count })}
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleStash}>
        {t("workspace.sourceControl.changes.stashSelected", { count })}
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleIgnore}>
        {t("workspace.sourceControl.changes.ignoreSelected", { count })}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem destructive onSelect={handleDiscard}>
        {t("workspace.sourceControl.changes.discardSelected", { count })}
      </ContextMenuItem>
    </>
  );
}

/** Trailing clipboard/reveal items shared by file and directory menus. */
function ClipboardMenuItems({
  count,
  revealPath,
  canReveal,
  onReveal,
  onBatchAction,
}: {
  count: number;
  revealPath: string;
  canReveal: boolean;
  onReveal: (path: string) => void;
  onBatchAction: (action: BatchAction) => void;
}) {
  const { t } = useTranslation();
  const handleCopyPatch = useCallback(() => onBatchAction("copy-patch"), [onBatchAction]);
  const handleCopyPaths = useCallback(() => onBatchAction("copy-paths"), [onBatchAction]);
  const handleReveal = useCallback(() => onReveal(revealPath), [onReveal, revealPath]);

  return (
    <>
      <ContextMenuSeparator />
      {canReveal ? (
        <ContextMenuItem onSelect={handleReveal}>
          {t("workspace.sourceControl.changes.revealInFileManager")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={handleCopyPatch}>
        {t("workspace.sourceControl.changes.copyPatch", { count })}
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleCopyPaths}>
        {t("workspace.sourceControl.changes.copyRelativePath", { count })}
      </ContextMenuItem>
    </>
  );
}

function ChangedDirRow({
  dir,
  depth,
  group,
  collapsed,
  selected,
  selectionCount,
  onToggleDir,
  onSelectPaths,
  onEnsurePathsSelected,
  onBatchAction,
  canReveal,
  onReveal,
}: {
  dir: FileTreeDir<CheckoutGitStatusFile>;
  depth: number;
  group: ChangeGroup;
  collapsed: boolean;
  selected: boolean;
  selectionCount: number;
  onToggleDir: (collapseKey: string) => void;
  onSelectPaths: (group: ChangeGroup, paths: string[], additive: boolean) => void;
  onEnsurePathsSelected: (group: ChangeGroup, paths: string[]) => void;
  onBatchAction: (action: BatchAction) => void;
  canReveal: boolean;
  onReveal: (path: string) => void;
}) {
  const subtreePaths = useMemo(() => collectFilePaths(dir), [dir]);

  const handleToggle = useCallback(
    () => onToggleDir(`${group}:${dir.path}`),
    [onToggleDir, group, dir.path],
  );
  // Pressing the row body selects the whole subtree; the chevron collapses.
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      onSelectPaths(group, subtreePaths, isAdditiveSelectEvent(event));
    },
    [onSelectPaths, group, subtreePaths],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onEnsurePathsSelected(group, subtreePaths);
      }
    },
    [onEnsurePathsSelected, group, subtreePaths],
  );

  const rowStyle = useMemo(
    () => [
      styles.treeRow,
      { paddingLeft: 12 + depth * TREE_INDENT },
      selected ? styles.fileRowSelected : null,
    ],
    [depth, selected],
  );
  const accessibilityState = useMemo(
    () => ({ expanded: !collapsed, selected }),
    [collapsed, selected],
  );
  const effectiveCount = selected ? Math.max(selectionCount, 1) : subtreePaths.length;

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        enabledOnMobile
        accessibilityRole="button"
        accessibilityLabel={dir.name}
        accessibilityState={accessibilityState}
        onPress={handlePress}
        style={rowStyle}
        testID={`source-control-tree-dir-${group}-${dir.path}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dir.name}
          onPress={handleToggle}
          hitSlop={4}
          style={styles.dirToggle}
          testID={`source-control-tree-dir-toggle-${group}-${dir.path}`}
        >
          {collapsed ? (
            <ThemedChevronRight size={FILE_ICON_SIZE} uniProps={mutedIconMapping} />
          ) : (
            <ThemedChevronDown size={FILE_ICON_SIZE} uniProps={mutedIconMapping} />
          )}
        </Pressable>
        <Text style={styles.dirName} numberOfLines={1}>
          {dir.name}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <BatchMenuItems group={group} count={effectiveCount} onBatchAction={onBatchAction} />
        <ClipboardMenuItems
          count={effectiveCount}
          revealPath={dir.path}
          canReveal={canReveal}
          onReveal={onReveal}
          onBatchAction={onBatchAction}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ChangedFileRow({
  name,
  file,
  depth,
  group,
  selected,
  selectionCount,
  onSelectPaths,
  onEnsurePathsSelected,
  onBatchAction,
  onOpenFile,
  onOpenDiffFile,
  canReveal,
  onReveal,
}: {
  name: string;
  file: CheckoutGitStatusFile;
  depth: number;
  group: ChangeGroup;
  selected: boolean;
  selectionCount: number;
  onSelectPaths: (group: ChangeGroup, paths: string[], additive: boolean) => void;
  onEnsurePathsSelected: (group: ChangeGroup, paths: string[]) => void;
  onBatchAction: (action: BatchAction) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDiffFile?: (filePath: string) => void;
  canReveal: boolean;
  onReveal: (path: string) => void;
}) {
  const { t } = useTranslation();
  const staged = group === "staged";
  const handleOpenDiff = useCallback(
    () => onOpenDiffFile?.(file.path),
    [onOpenDiffFile, file.path],
  );
  const handleOpenFile = useCallback(() => onOpenFile?.(file.path), [onOpenFile, file.path]);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const additive = isAdditiveSelectEvent(event);
      onSelectPaths(group, [file.path], additive);
      // Plain click also opens the file's diff preview tab; Ctrl/Cmd clicks
      // stay selection-only so multi-select doesn't spam tabs.
      if (!additive) {
        onOpenDiffFile?.(file.path);
      }
    },
    [onSelectPaths, group, file.path, onOpenDiffFile],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onEnsurePathsSelected(group, [file.path]);
      }
    },
    [onEnsurePathsSelected, group, file.path],
  );

  const rowStyle = useMemo(
    () => [
      styles.treeRow,
      { paddingLeft: 12 + depth * TREE_INDENT },
      selected ? styles.fileRowSelected : null,
    ],
    [depth, selected],
  );
  const iconXml = useMemo(() => getFileIconSvg(name), [name]);

  const additions = staged ? file.indexAdditions : file.worktreeAdditions;
  const deletions = staged ? file.indexDeletions : file.worktreeDeletions;
  // The count of files the menu actions will hit (the row itself when it is
  // not yet part of the selection).
  const effectiveCount = selected ? Math.max(selectionCount, 1) : 1;

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        enabledOnMobile
        accessibilityRole="button"
        accessibilityLabel={file.path}
        onPress={handlePress}
        style={rowStyle}
        testID={`source-control-tree-file-${group}-${file.path}`}
      >
        <SvgXml xml={iconXml} width={FILE_ICON_SIZE} height={FILE_ICON_SIZE} />
        <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
          {name}
        </Text>
        <View style={styles.fileMeta}>
          {typeof additions === "number" && additions > 0 ? (
            <Text style={styles.addedCount}>+{additions}</Text>
          ) : null}
          {typeof deletions === "number" && deletions > 0 ? (
            <Text style={styles.deletedCount}>−{deletions}</Text>
          ) : null}
          <Text style={styles.statusLetter}>{statusLetter(file, staged)}</Text>
        </View>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onOpenDiffFile ? (
          <ContextMenuItem onSelect={handleOpenDiff}>
            {t("workspace.sourceControl.changes.openChanges")}
          </ContextMenuItem>
        ) : null}
        {onOpenFile && file.worktreeStatus !== "D" ? (
          <ContextMenuItem onSelect={handleOpenFile}>
            {t("workspace.sourceControl.changes.openFile")}
          </ContextMenuItem>
        ) : null}
        {onOpenDiffFile || onOpenFile ? <ContextMenuSeparator /> : null}
        <BatchMenuItems group={group} count={effectiveCount} onBatchAction={onBatchAction} />
        <ClipboardMenuItems
          count={effectiveCount}
          revealPath={file.path}
          canReveal={canReveal && file.worktreeStatus !== "D"}
          onReveal={onReveal}
          onBatchAction={onBatchAction}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  stateRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "flex-start",
  },
  stateText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  groupTitle: {
    fontSize: 10,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 26,
    paddingRight: theme.spacing[3],
  },
  fileRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  dirToggle: {
    width: 18,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  dirName: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fileName: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  fileMeta: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  addedCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusSuccess,
    fontVariant: ["tabular-nums"],
  },
  deletedCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusDanger,
    fontVariant: ["tabular-nums"],
  },
  statusLetter: {
    width: 12,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
