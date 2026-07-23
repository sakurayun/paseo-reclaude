import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/**
 * Open a fresh "new agent" draft window seeded with `text`. On wide layouts it
 * opens as a right split next to the current chat; on compact layouts it opens
 * as a new focused tab. The draft store is seeded before the tab opens so the
 * new composer hydrates with the text already waiting in its input.
 *
 * Returns true when a tab was opened.
 */
export function openSeededDraftWindow(input: {
  serverId: string;
  workspaceId: string;
  text: string;
  splitRight: boolean;
}): boolean {
  const persistenceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!persistenceKey) {
    return false;
  }

  const layout = useWorkspaceLayoutStore.getState();
  const draftId = generateDraftId();
  // draftId is what keys the draft (agentId is ignored once a draftId is set),
  // so seeding here lands in the new tab's composer on mount.
  const draftKey = buildDraftStoreKey({ serverId: input.serverId, agentId: "", draftId });
  useDraftStore.getState().saveDraftInput({
    draftKey,
    draft: { text: input.text, attachments: [], transcriptAttachments: [] },
  });

  if (input.splitRight) {
    const focusedPaneId = layout.layoutByWorkspace[persistenceKey]?.focusedPaneId ?? null;
    if (focusedPaneId) {
      // Splitting focuses the new empty pane, so openTabFocused below lands in it.
      layout.splitPaneEmpty(persistenceKey, { targetPaneId: focusedPaneId, position: "right" });
    }
  }

  return layout.openTabFocused(persistenceKey, { kind: "draft", draftId }) !== null;
}
