import { useCallback, useMemo, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react-native";
import { Text, View } from "react-native";
import invariant from "tiny-invariant";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
import { TerminalPane } from "@/components/terminal-pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import type { PanelIconProps } from "@/panels/panel-registry";
import { OsBadge } from "@/components/ssh/os-badge";
import { useSshTerminalHostOs } from "@/screens/ssh/use-ssh-terminal-host-os";
import { queryClient } from "@/data/query-client";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { showExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import { useSshTerminalMeta } from "@/stores/ssh-terminal-meta-store";

type ListTerminalsPayload = ListTerminalsResponse["payload"];

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function useTerminalPanelDescriptor(
  target: { kind: "terminal"; terminalId: string },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const remote = useSshTerminalMeta(target.terminalId);
  const { isSsh, os } = useSshTerminalHostOs(context.serverId, target.terminalId);
  const client = useSessionStore((state) => state.sessions[context.serverId]?.client ?? null);
  const workspaceDirectory = useWorkspaceDirectory(context.serverId, context.workspaceId);
  const terminalsQuery = useQuery(
    {
      queryKey: buildTerminalsQueryKey(
        context.serverId,
        workspaceDirectory,
        context.workspaceId || null,
      ),
      enabled: Boolean(client && workspaceDirectory),
      queryFn: async (): Promise<ListTerminalsPayload> => {
        if (!client || !workspaceDirectory) {
          throw new Error("Workspace directory not found");
        }
        return client.listTerminals(workspaceDirectory, undefined, {
          workspaceId: context.workspaceId || undefined,
        });
      },
      staleTime: 5_000,
    },
    queryClient,
  );
  const terminal =
    terminalsQuery.data?.terminals.find((entry) => entry.id === target.terminalId) ?? null;
  const label =
    trimNonEmpty(terminal?.title ?? terminal?.name ?? null) ??
    t("workspace.tabs.fallback.terminal");

  // SSH terminals show the remote host's OS brand badge; the tab row's mono
  // color is intentionally ignored — the badge is the host's identity.
  const icon = useMemo<ComponentType<PanelIconProps>>(() => {
    if (!isSsh) {
      return Terminal;
    }
    return function SshTerminalTabIcon({ size }: PanelIconProps) {
      return <OsBadge os={os} size={size} />;
    };
  }, [isSsh, os]);

  return {
    // Remote terminals may not be in this workspace's listTerminals, so use
    // the host label from the meta store rather than the "Terminal" fallback.
    label:
      trimNonEmpty(remote?.label ?? null) ??
      trimNonEmpty(terminal?.title ?? terminal?.name ?? null) ??
      t("workspace.tabs.fallback.terminal"),
    subtitle: t("workspace.tabs.fallback.terminal"),
    tooltip: label,
    titleState: terminalsQuery.isPending ? "loading" : "ready",
    icon,
    statusBucket: deriveTerminalActivityStatusBucket(terminal?.activity),
  };
}

function noop(): void {}

function TerminalPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const { isWorkspaceFocused, isPaneFocused } = usePaneFocus();
  invariant(target.kind === "terminal", "TerminalPanel requires terminal target");
  // SSH terminals live in a real workspace's tab bar but run on a remote host:
  // suppress local file-link/explorer actions (remote paths must not resolve
  // against the daemon host) and — since the remote terminal isn't in this
  // workspace's directory — don't gate rendering on a local directory.
  const remote = useSshTerminalMeta(target.terminalId);
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.workspaceDirectory,
  }));
  const workspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const isCompact = useIsCompactFormFactor();
  const handleOpenFileExplorer = useCallback(() => {
    if (!workspaceDirectory) {
      return;
    }
    showExplorerSidebar({
      isCompact,
      workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    });
  }, [isCompact, serverId, workspaceId, workspaceDirectory]);
  invariant(target.kind === "terminal", "TerminalPanel requires terminal target");

  if (!workspaceDirectory) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>Workspace directory not found.</Text>
      </View>
    );
  }

  return (
    <TerminalPane
      serverId={serverId}
      cwd={workspaceDirectory}
      terminalId={target.terminalId}
      workspaceId={workspaceId}
      isWorkspaceFocused={isWorkspaceFocused}
      isPaneFocused={isPaneFocused}
      onOpenFileExplorer={remote ? noop : handleOpenFileExplorer}
      onOpenWorkspaceFile={remote ? noop : openFileInWorkspace}
      localFileLinks={!remote}
      sshHostId={remote?.hostId ?? null}
    />
  );
}

export const terminalPanelRegistration = definePanel("terminal", {
  component: TerminalPanel,
  useDescriptor: useTerminalPanelDescriptor,
});
