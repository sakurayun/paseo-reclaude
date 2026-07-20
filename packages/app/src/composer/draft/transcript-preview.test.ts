import { describe, expect, it } from "vitest";
import type {
  ChatHistoryContextAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { findPersistedDraftTranscriptAttachment } from "./transcript-preview";

function persistedTranscript(): ChatHistoryContextAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:source-host:source-agent",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Transcript · Source agent",
      text: "Previous conversation",
    },
    source: {
      serverId: "source-host",
      agentId: "source-agent",
    },
  };
}

describe("findPersistedDraftTranscriptAttachment", () => {
  it("returns a durable draft transcript with matching attachment and source identities", () => {
    const transcript = persistedTranscript();

    expect(
      findPersistedDraftTranscriptAttachment({
        attachment: transcript,
        transcriptAttachments: [transcript],
      }),
    ).toBe(transcript);
  });

  it("does not treat a transient Fork attachment as a persisted transcript preview", () => {
    const transcript = persistedTranscript();
    const forkContext: WorkspaceComposerAttachment = {
      ...transcript,
      id: "chat_history:destination-draft",
    };

    expect(
      findPersistedDraftTranscriptAttachment({
        attachment: forkContext,
        transcriptAttachments: [transcript],
      }),
    ).toBeNull();
  });
});
