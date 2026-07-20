import type {
  ChatHistoryContextAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { getChatHistorySourceKey } from "@/attachments/chat-history-identity";

function getAttachmentSourceKey(attachment: WorkspaceComposerAttachment): string | null {
  if (attachment.kind !== "chat_history") {
    return null;
  }
  return getChatHistorySourceKey(attachment.source);
}

/**
 * Durable draft snapshots take precedence over transient context for the same
 * source session. This prevents a Fork attachment and an Add transcripts
 * snapshot from sending the same conversation twice under different ids.
 */
export function mergeWorkspaceAttachments(input: {
  persistent: readonly WorkspaceComposerAttachment[];
  scoped: readonly WorkspaceComposerAttachment[];
}): WorkspaceComposerAttachment[] {
  const transcriptSourceKeys = new Set<string>();
  const merged: WorkspaceComposerAttachment[] = [];
  for (const attachment of [...input.persistent, ...input.scoped]) {
    const sourceKey = getAttachmentSourceKey(attachment);
    if (sourceKey !== null) {
      if (transcriptSourceKeys.has(sourceKey)) {
        continue;
      }
      transcriptSourceKeys.add(sourceKey);
    }
    merged.push(attachment);
  }
  return merged;
}

export function selectEffectiveChatHistoryAttachments(input: {
  persistent: readonly WorkspaceComposerAttachment[];
  scoped: readonly WorkspaceComposerAttachment[];
}): ChatHistoryContextAttachment[] {
  return mergeWorkspaceAttachments(input).filter(
    (attachment): attachment is ChatHistoryContextAttachment => attachment.kind === "chat_history",
  );
}
