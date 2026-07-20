import type {
  ChatHistoryContextAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";

/**
 * Returns a transcript only when the attachment belongs to this persisted New
 * Agent draft. Fork context is transient and can have the same source session,
 * so its draft-scoped attachment id must match as well.
 */
export function findPersistedDraftTranscriptAttachment(input: {
  attachment: WorkspaceComposerAttachment;
  transcriptAttachments: readonly ChatHistoryContextAttachment[];
}): ChatHistoryContextAttachment | null {
  const { attachment, transcriptAttachments } = input;
  if (attachment.kind !== "chat_history") {
    return null;
  }

  return (
    transcriptAttachments.find(
      (candidate) =>
        candidate.id === attachment.id &&
        candidate.source.serverId === attachment.source.serverId &&
        candidate.source.agentId === attachment.source.agentId,
    ) ?? null
  );
}
