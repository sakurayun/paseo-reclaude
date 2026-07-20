import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import { getChatHistoryContextSubtitle } from "./chat-history-presentation";

const t = ((key: string, values?: Record<string, number>) => {
  if (key === "addTranscripts.attachmentSummary.truncated") {
    return `Recent ${values?.included} of ${values?.total} items`;
  }
  if (key === "addTranscripts.attachmentSummary.truncatedUnknown") {
    return "Recent portion";
  }
  if (key === "addTranscripts.attachmentSummary.capturedWhileRunning") {
    return "Captured while running";
  }
  if (key === "message.attachments.textAttachment") {
    return "Text attachment";
  }
  if (key === "message.attachments.previousConversation") {
    return "Previous conversation";
  }
  return key;
}) as unknown as TFunction;

function createTranscript(
  source: ChatHistoryContextAttachment["source"],
): ChatHistoryContextAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:source-host:source-agent",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Transcript · Source agent",
      text: "Prior conversation",
    },
    source,
  };
}

describe("chat-history attachment pill content", () => {
  it("identifies bounded snapshots by their retained and total item counts", () => {
    const subtitle = getChatHistoryContextSubtitle(
      createTranscript({
        serverId: "source-host",
        agentId: "source-agent",
        truncated: true,
        includedItemCount: 12,
        itemCount: 40,
      }),
      t,
    );

    expect(subtitle).toBe("Recent 12 of 40 items");
  });

  it("uses a generic recent-portion label when bounded count metadata is unavailable", () => {
    const subtitle = getChatHistoryContextSubtitle(
      createTranscript({
        serverId: "source-host",
        agentId: "source-agent",
        truncated: true,
        includedItemCount: Number.POSITIVE_INFINITY,
        itemCount: 40,
      }),
      t,
    );

    expect(subtitle).toBe("Recent portion");
  });

  it("retains the existing previous-conversation subtitle for complete snapshots", () => {
    const subtitle = getChatHistoryContextSubtitle(
      createTranscript({
        serverId: "source-host",
        agentId: "source-agent",
        itemCount: 40,
      }),
      t,
    );

    expect(subtitle).toBe("Previous conversation");
  });

  it("shows immutable source provenance and running capture state", () => {
    const subtitle = getChatHistoryContextSubtitle(
      createTranscript({
        serverId: "source-host",
        agentId: "source-agent",
        workspaceLabel: "feature-worktree",
        serverLabel: "Mac Studio",
        capturedWhileRunning: true,
        truncated: true,
        includedItemCount: 12,
        itemCount: 40,
      }),
      t,
    );

    expect(subtitle).toBe(
      "feature-worktree · Mac Studio · Captured while running · Recent 12 of 40 items",
    );
  });
});
