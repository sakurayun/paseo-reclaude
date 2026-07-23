import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { toWorkspaceRelativePath } from "@/workspace/classify-workspace-path";

interface DirectoryBrowserProps {
  serverId: string;
  /** Absolute directory being browsed (listDirectory root). */
  absolutePath: string;
  /** The real workspace root — used to re-scope open targets when possible. */
  workspaceRoot: string;
  onOpenFile: (path: string) => void;
}

/**
 * Outside-workspace directory browser for terminal path clicks (e.g. `cd ..`
 * then Ctrl+click `pwd`). Reuses the same FileExplorerPane UI as the right
 * sidebar so rows, icons, sort, and expand behavior stay consistent.
 *
 * Explorer state is keyed by `root:${absolutePath}` (workspaceId omitted) so
 * browsing a parent folder never pollutes the workspace sidebar state.
 */
export function DirectoryBrowser({
  serverId,
  absolutePath,
  workspaceRoot,
  onOpenFile,
}: DirectoryBrowserProps) {
  const handleOpenFile = useCallback(
    (entryPath: string) => {
      const absoluteChild = buildAbsoluteExplorerPath({
        workspaceRoot: absolutePath,
        entryPath,
      });
      const relativeToWorkspace = toWorkspaceRelativePath({
        path: absoluteChild,
        workspaceRoot,
      });
      onOpenFile(relativeToWorkspace ?? absoluteChild);
    },
    [absolutePath, onOpenFile, workspaceRoot],
  );

  return (
    <View style={styles.container} testID="directory-browser">
      <FileExplorerPane
        serverId={serverId}
        workspaceRoot={absolutePath}
        onOpenFile={handleOpenFile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
});
