import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { GitCommitFileStatus } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { getFileIconSvg } from "@/components/material-file-icons";
import { isNative } from "@/constants/platform";
import {
  buildCommitFileTree,
  flattenCommitFileTree,
  type CommitFileDir,
  type CommitFileLeaf,
} from "./commit-file-tree";
import { useCommitFilesQuery } from "./use-source-control-queries";

const TREE_INDENT = 14;
const FILE_ICON_SIZE = 14;

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const STATUS_LETTER: Record<GitCommitFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  unmerged: "U",
  unknown: "?",
};

interface CommitFilesListProps {
  serverId: string;
  cwd: string;
  hash: string;
  onOpenFile?: (filePath: string) => void;
}

/**
 * The files a commit touched, grouped into a directory tree (expanded by
 * default) with file-explorer-style material icons. Tapping a file opens it.
 */
export function CommitFilesList({ serverId, cwd, hash, onOpenFile }: CommitFilesListProps) {
  const { t } = useTranslation();
  const query = useCommitFilesQuery({ serverId, cwd, hash, enabled: true });
  const tree = useMemo(() => buildCommitFileTree(query.data ?? []), [query.data]);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => flattenCommitFileTree(tree, collapsedPaths), [tree, collapsedPaths]);

  const handleToggleDir = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (query.isLoading) {
    return (
      <View style={styles.stateRow}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={styles.stateRow}>
        <Text style={styles.stateText}>{t("workspace.sourceControl.commit.filesError")}</Text>
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={styles.stateRow}>
        <Text style={styles.stateText}>{t("workspace.sourceControl.commit.noFiles")}</Text>
      </View>
    );
  }
  return (
    <View>
      {rows.map(({ node, depth }) =>
        node.kind === "dir" ? (
          <CommitDirRow
            key={`dir-${node.path}`}
            dir={node}
            depth={depth}
            collapsed={collapsedPaths.has(node.path)}
            onToggle={handleToggleDir}
          />
        ) : (
          <CommitFileRow
            key={`file-${node.file.path}`}
            leaf={node}
            depth={depth}
            onOpenFile={onOpenFile}
          />
        ),
      )}
    </View>
  );
}

function indentStyle(depth: number) {
  return { paddingLeft: depth * TREE_INDENT };
}

function CommitDirRow({
  dir,
  depth,
  collapsed,
  onToggle,
}: {
  dir: CommitFileDir;
  depth: number;
  collapsed: boolean;
  onToggle: (path: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(dir.path), [dir.path, onToggle]);
  const rowStyle = useMemo(() => [styles.treeRow, indentStyle(depth)], [depth]);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir.name}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={rowStyle}
      testID={`commit-dir-${dir.path}`}
    >
      {collapsed ? (
        <ThemedChevronRight size={FILE_ICON_SIZE} uniProps={mutedIconMapping} />
      ) : (
        <ThemedChevronDown size={FILE_ICON_SIZE} uniProps={mutedIconMapping} />
      )}
      <Text style={styles.dirName} numberOfLines={1}>
        {dir.name}
      </Text>
    </Pressable>
  );
}

function statusStyle(status: GitCommitFileStatus) {
  switch (status) {
    case "added":
      return styles.statusAdded;
    case "deleted":
      return styles.statusDeleted;
    case "renamed":
    case "copied":
      return styles.statusRenamed;
    default:
      return styles.statusModified;
  }
}

function CommitFileRow({
  leaf,
  depth,
  onOpenFile,
}: {
  leaf: CommitFileLeaf;
  depth: number;
  onOpenFile?: (filePath: string) => void;
}) {
  const { file } = leaf;
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    // Deleted files no longer exist in the worktree, so there is nothing to open.
    if (file.status !== "deleted") {
      onOpenFile?.(file.path);
    }
  }, [file.path, file.status, onOpenFile]);

  const rowStyle = useMemo(
    () => [
      styles.treeRow,
      indentStyle(depth),
      (isHovered || isNative) && onOpenFile ? styles.fileRowHovered : null,
    ],
    [depth, isHovered, onOpenFile],
  );
  const letterStyle = useMemo(() => [styles.statusLetter, statusStyle(file.status)], [file.status]);
  const iconXml = useMemo(() => getFileIconSvg(leaf.name), [leaf.name]);
  const accessibilityLabel = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

  return (
    <View
      style={styles.fileRowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
        disabled={!onOpenFile || file.status === "deleted"}
        style={rowStyle}
        testID={`commit-file-${file.path}`}
      >
        <SvgXml xml={iconXml} width={FILE_ICON_SIZE} height={FILE_ICON_SIZE} />
        <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
          {leaf.name}
        </Text>
        {file.oldPath ? (
          <Text style={styles.oldPath} numberOfLines={1} ellipsizeMode="middle">
            ← {file.oldPath}
          </Text>
        ) : null}
        <Text style={letterStyle}>{STATUS_LETTER[file.status]}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stateRow: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    alignItems: "flex-start",
  },
  stateText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fileRowContainer: {
    position: "relative",
  },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  fileRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
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
  oldPath: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  statusLetter: {
    marginLeft: "auto",
    width: 12,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  statusAdded: {
    color: theme.colors.statusSuccess,
  },
  statusModified: {
    color: theme.colors.statusWarning,
  },
  statusDeleted: {
    color: theme.colors.statusDanger,
  },
  statusRenamed: {
    color: theme.colors.statusMerged,
  },
}));
