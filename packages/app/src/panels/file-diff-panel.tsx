import { Text, View } from "react-native";
import { GitCompareArrows } from "lucide-react-native";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";
import { GitDiffPane } from "@/git/diff-pane";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFileDiffPanelDescriptor(target: { kind: "file-diff"; path: string }) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  return {
    label: fileName,
    subtitle: target.path,
    titleState: "ready" as const,
    icon: GitCompareArrows,
    statusBucket: null,
  };
}

/** Single-file diff preview opened from the source control changes list. */
function FileDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "file-diff", "FileDiffPanel requires file-diff target");
  if (!workspaceDirectory) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <GitDiffPane
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={workspaceDirectory}
      hideHeaderRow
      focusFile={target.path}
    />
  );
}

export const fileDiffPanelRegistration: PanelRegistration<"file-diff"> = {
  kind: "file-diff",
  component: FileDiffPanel,
  useDescriptor: useFileDiffPanelDescriptor,
};
