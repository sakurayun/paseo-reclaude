import React, { useEffect, useMemo, type ComponentType } from "react";
import invariant from "tiny-invariant";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getPanelRegistration } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { RenderProfile } from "@/utils/render-profiler";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import {
  clearActivePaneFindPaneId,
  createPaneFindPaneId,
  setActivePaneFindPaneId,
} from "@/panels/pane-find-registry";

export interface WorkspacePaneContentModel {
  key: string;
  Component: ComponentType;
  paneContextValue: PaneContextValue;
}

export interface BuildWorkspacePaneContentModelInput {
  tab: WorkspaceTabDescriptor;
  paneId?: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onOpenTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onCloseCurrentTab: () => void;
  onRetargetCurrentTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet: () => void;
}

export function buildWorkspacePaneContentModel({
  tab,
  paneId,
  normalizedServerId,
  normalizedWorkspaceId,
  onOpenTab,
  onCloseCurrentTab,
  onRetargetCurrentTab,
  onOpenWorkspaceFile,
  onOpenImportSheet,
}: BuildWorkspacePaneContentModelInput): WorkspacePaneContentModel {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);
  const paneInstanceId = paneId
    ? createPaneFindPaneId({
        serverId: normalizedServerId,
        workspaceId: normalizedWorkspaceId,
        paneId,
      })
    : null;
  return {
    key: `${normalizedServerId}:${normalizedWorkspaceId}:${tab.tabId}`,
    Component: registration.component,
    paneContextValue: {
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      paneInstanceId,
      tabId: tab.tabId,
      target: tab.target,
      openTab: onOpenTab,
      closeCurrentTab: onCloseCurrentTab,
      retargetCurrentTab: onRetargetCurrentTab,
      openFileInWorkspace: onOpenWorkspaceFile,
      openImportSheet: onOpenImportSheet,
    },
  };
}

export interface WorkspacePaneContentProps {
  content: WorkspacePaneContentModel;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onFocusPane?: () => void;
}

export function WorkspacePaneContent({
  content,
  isWorkspaceFocused,
  isPaneFocused,
  onFocusPane,
}: WorkspacePaneContentProps) {
  const { Component, key, paneContextValue } = content;
  const openTab = useStableEvent(paneContextValue.openTab);
  const closeCurrentTab = useStableEvent(paneContextValue.closeCurrentTab);
  const retargetCurrentTab = useStableEvent(paneContextValue.retargetCurrentTab);
  const openFileInWorkspace = useStableEvent(paneContextValue.openFileInWorkspace);
  const openImportSheet = useStableEvent(paneContextValue.openImportSheet);
  const stablePaneContextValue = useMemo(
    () => ({
      serverId: paneContextValue.serverId,
      workspaceId: paneContextValue.workspaceId,
      paneInstanceId: paneContextValue.paneInstanceId,
      tabId: paneContextValue.tabId,
      target: paneContextValue.target,
      openTab,
      closeCurrentTab,
      retargetCurrentTab,
      openFileInWorkspace,
      openImportSheet,
    }),
    [
      closeCurrentTab,
      openFileInWorkspace,
      openImportSheet,
      openTab,
      paneContextValue.paneInstanceId,
      paneContextValue.serverId,
      paneContextValue.tabId,
      paneContextValue.target,
      paneContextValue.workspaceId,
      retargetCurrentTab,
    ],
  );
  const paneFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused,
        isPaneFocused,
        onFocusPane,
      }),
    [isPaneFocused, isWorkspaceFocused, onFocusPane],
  );
  useEffect(() => {
    if (!paneContextValue.paneInstanceId || !isWorkspaceFocused || !isPaneFocused) {
      return;
    }
    const paneInstanceId = paneContextValue.paneInstanceId;
    setActivePaneFindPaneId(paneInstanceId);
    return () => {
      clearActivePaneFindPaneId(paneInstanceId);
    };
  }, [isPaneFocused, isWorkspaceFocused, paneContextValue.paneInstanceId]);

  return (
    <RenderProfile
      id={`WorkspacePaneContent:${paneContextValue.target.kind}:${paneContextValue.tabId}`}
    >
      <PaneProvider value={stablePaneContextValue}>
        <PaneFocusProvider value={paneFocusValue}>
          <Component key={key} />
        </PaneFocusProvider>
      </PaneProvider>
    </RenderProfile>
  );
}
