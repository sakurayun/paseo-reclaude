import type { TFunction } from "i18next";
import type { WorkspaceComposerAttachment } from "@/attachments/types";

/** Builds the compact provenance and truncation line shared by pills and preview. */
export function getChatHistoryContextSubtitle(
  attachment: Extract<WorkspaceComposerAttachment, { kind: "chat_history" }>,
  t: TFunction,
): string {
  const parts = [attachment.source.workspaceLabel, attachment.source.serverLabel]
    .map((value) => value?.trim())
    .filter((value, index, values): value is string =>
      Boolean(value && values.indexOf(value) === index),
    );

  if (attachment.source.capturedWhileRunning) {
    parts.push(t("addTranscripts.attachmentSummary.capturedWhileRunning"));
  }

  if (!attachment.source.truncated) {
    return parts.length > 0 ? parts.join(" · ") : t("message.attachments.previousConversation");
  }

  const { includedItemCount, itemCount } = attachment.source;
  if (
    typeof includedItemCount === "number" &&
    Number.isFinite(includedItemCount) &&
    typeof itemCount === "number" &&
    Number.isFinite(itemCount)
  ) {
    parts.push(
      t("addTranscripts.attachmentSummary.truncated", {
        included: includedItemCount,
        total: itemCount,
      }),
    );
    return parts.join(" · ");
  }

  parts.push(t("addTranscripts.attachmentSummary.truncatedUnknown"));
  return parts.join(" · ");
}
