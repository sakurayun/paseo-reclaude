import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { router } from "expo-router";
import { FolderPlus } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ComboboxItem } from "@/components/ui/combobox";
import { useToast } from "@/contexts/toast-context";
import { pickDirectory } from "@/desktop/pick-directory";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import type { OpenProjectResult } from "@/hooks/open-project";
import { useOpenProject } from "@/hooks/use-open-project";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

/**
 * "Add project" action shown inside the Choose project dropdown, below the
 * search box. Reuses the sidebar's open-project flow: pick a folder, register it
 * as a project, then re-enter the New workspace screen with the new project
 * preselected (route projectId -> routeProject -> initialProject).
 *
 * Rendered via the combobox `listHeader` slot so it is never filtered by the
 * search query and stays reachable when the project list is empty. The row only
 * appears when the action can actually run: the native folder picker requires
 * Electron, and a locally-picked path is only meaningful on a same-machine
 * (local) daemon.
 */
export function ProjectPickerAddProjectRow({
  serverId,
  onActivate,
}: {
  serverId: string;
  /** Fired synchronously on press, e.g. to close the dropdown before picking. */
  onActivate?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId || "");
  const openProject = useOpenProject(serverId || null);

  const leadingSlot = useMemo(
    () => (
      <View style={styles.iconBox}>
        <FolderPlus size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </View>
    ),
    [theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  const handlePress = useCallback(() => {
    onActivate?.();
    if (!serverId) return;
    void runAddProjectFlow({
      serverId,
      openProject,
      onError: (message) => toast.error(message),
      fallbackError: t("sidebar.project.toasts.hostDisconnected"),
    });
  }, [onActivate, openProject, serverId, t, toast]);

  if (!isLocalDaemon) return null;

  return (
    <ComboboxItem
      testID="new-workspace-project-picker-add-project"
      label={t("newWorkspace.addProject")}
      onPress={handlePress}
      leadingSlot={leadingSlot}
    />
  );
}

async function runAddProjectFlow(input: {
  serverId: string;
  openProject: (path: string) => Promise<OpenProjectResult>;
  onError: (message: string) => void;
  fallbackError: string;
}): Promise<void> {
  try {
    const path = await pickDirectory();
    if (!path) return;
    const result = await input.openProject(path);
    if (!result.ok) {
      input.onError(result.error ?? input.fallbackError);
      return;
    }
    router.navigate(
      buildNewWorkspaceRoute({
        serverId: input.serverId,
        sourceDirectory: result.project.projectRootPath,
        projectId: result.project.projectId,
      }),
    );
  } catch (error) {
    input.onError(error instanceof Error ? error.message : String(error));
  }
}

const styles = StyleSheet.create((theme) => ({
  iconBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
