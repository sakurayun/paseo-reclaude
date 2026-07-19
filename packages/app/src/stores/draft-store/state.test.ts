import { describe, expect, it } from "vitest";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import {
  applyClearDraftRecord,
  buildDraftTranscriptAttachmentId,
  pruneFinalizedDraftRecords,
  removeDraftTranscriptAttachment,
  toDraftInputIfReady,
  upsertDraftTranscriptAttachment,
} from "./state";

function transcriptAttachment(input: {
  serverId: string;
  agentId: string;
  text: string;
}): ChatHistoryContextAttachment {
  return {
    kind: "chat_history",
    id: "temporary-id",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Source transcript",
      text: input.text,
    },
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      itemCount: 12,
      includedItemCount: 8,
      byteCount: 256,
      truncated: true,
    },
  };
}

describe("draft-store lifecycle", () => {
  it("prunes finalized tombstones after TTL", () => {
    const nowMs = 1_000_000;
    const drafts = {
      oldSent: {
        input: { text: "", attachments: [], transcriptAttachments: [] },
        lifecycle: "sent" as const,
        updatedAt: 0,
        version: 2,
      },
      recentAbandoned: {
        input: { text: "", attachments: [], transcriptAttachments: [] },
        lifecycle: "abandoned" as const,
        updatedAt: nowMs + 2 * 60 * 1000,
        version: 2,
      },
      active: {
        input: { text: "a", attachments: [], transcriptAttachments: [] },
        lifecycle: "active" as const,
        updatedAt: 0,
        version: 1,
      },
    };

    const pruned = pruneFinalizedDraftRecords({
      drafts,
      nowMs: nowMs + 6 * 60 * 1000,
    });

    expect(pruned.oldSent).toBeUndefined();
    expect(pruned.recentAbandoned).toBeDefined();
    expect(pruned.active).toBeDefined();
  });

  it("normalizes clear-with-lifecycle into a tombstone without attachments", () => {
    const cleared = applyClearDraftRecord({
      record: {
        input: {
          text: "hello",
          attachments: [
            {
              kind: "image",
              metadata: {
                id: "att-1",
                mimeType: "image/jpeg",
                storageType: "web-indexeddb",
                storageKey: "att-1",
                createdAt: 1,
              },
            },
          ],
          transcriptAttachments: [
            transcriptAttachment({
              serverId: "host-1",
              agentId: "agent-1",
              text: "Original transcript",
            }),
          ],
        },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      },
      lifecycle: "sent",
      nowMs: 2,
    });

    expect(cleared).toEqual({
      input: { text: "", attachments: [], transcriptAttachments: [] },
      lifecycle: "sent",
      updatedAt: 2,
      version: 2,
    });
  });
});

describe("draft-store normalization", () => {
  it("preserves New Workspace picker ownership when hydrating a draft", () => {
    const pickerAttachment = {
      kind: "github_pr" as const,
      owner: "new-workspace-picker" as const,
      item: {
        kind: "change_request" as const,
        number: 202,
        title: "Persist picker ownership",
        url: "https://example.com/pull/202",
        state: "open" as const,
        body: null,
        labels: [],
        baseRefName: "main",
        headRefName: "feature/picker-ownership",
      },
    };

    expect(
      toDraftInputIfReady({
        input: {
          text: "Keep this prompt",
          attachments: [pickerAttachment],
          transcriptAttachments: [],
        },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      }),
    ).toEqual({
      text: "Keep this prompt",
      attachments: [pickerAttachment],
      transcriptAttachments: [],
    });
  });

  it("replaces a transcript snapshot by source without changing its position", () => {
    const first = transcriptAttachment({
      serverId: "host-1",
      agentId: "agent-1",
      text: "Original transcript",
    });
    const second = transcriptAttachment({
      serverId: "host-2",
      agentId: "agent-2",
      text: "Second transcript",
    });
    const withFirst = upsertDraftTranscriptAttachment({ attachments: [], attachment: first });
    const withTwo = upsertDraftTranscriptAttachment({
      attachments: withFirst,
      attachment: second,
    });
    const refreshed = upsertDraftTranscriptAttachment({
      attachments: withTwo,
      attachment: transcriptAttachment({
        serverId: "host-1",
        agentId: "agent-1",
        text: "Refreshed transcript",
      }),
    });

    expect(refreshed).toMatchObject([
      {
        id: buildDraftTranscriptAttachmentId({ serverId: "host-1", agentId: "agent-1" }),
        attachment: { text: "Refreshed transcript" },
        source: {
          itemCount: 12,
          includedItemCount: 8,
          byteCount: 256,
          truncated: true,
        },
      },
      {
        id: buildDraftTranscriptAttachmentId({ serverId: "host-2", agentId: "agent-2" }),
        attachment: { text: "Second transcript" },
      },
    ]);

    expect(
      removeDraftTranscriptAttachment({
        attachments: refreshed,
        source: { serverId: "host-1", agentId: "agent-1" },
      }),
    ).toMatchObject([
      {
        id: buildDraftTranscriptAttachmentId({ serverId: "host-2", agentId: "agent-2" }),
      },
    ]);
  });
});
