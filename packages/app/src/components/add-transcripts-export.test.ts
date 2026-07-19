import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { getChatHistorySourceKey } from "@/attachments/chat-history-identity";
import { exportSelectedTranscripts } from "@/components/add-transcripts-export";

function agent(overrides: Partial<AggregatedAgent>): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "host-a",
    serverLabel: "Host A",
    title: "Source agent",
    status: "idle",
    lastActivityAt: new Date("2026-07-18T10:00:00.000Z"),
    cwd: "/repos/paseo",
    workspaceId: "workspace-a",
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    labels: {},
    projectPlacement: null,
    ...overrides,
  };
}

function transcriptResponse(text: string, totalItemCount: number | null = 1) {
  return {
    requestId: "request-1",
    agentId: "agent-1",
    attachment: {
      type: "text" as const,
      mimeType: "text/plain" as const,
      contextKind: "chat_history" as const,
      title: "Chat history",
      text,
    },
    totalItemCount,
    includedItemCount: 1,
    byteCount: new TextEncoder().encode(text).length,
    truncated: totalItemCount === null,
    capturedCursor: { epoch: "timeline-1", seq: 10 },
    error: null,
  };
}

const messages = {
  updateHost: "Update this host",
  unavailable: "Transcript unavailable",
  exportFailed: "Export failed",
  totalTooLarge: "Too large",
  maximumSelected: "Too many transcripts",
  attachmentTitle: (title: string) => `Transcript · ${title}`,
};

describe("exportSelectedTranscripts", () => {
  it("routes each source to its own host and preserves partial success", async () => {
    const sourceA = agent({ id: "agent-a", serverId: "host-a", title: "Alpha" });
    const sourceB = agent({ id: "agent-b", serverId: "host-b", title: "Beta" });
    const exportA = vi.fn(async () => transcriptResponse("[User] Alpha", null));
    const exportB = vi.fn(async () => {
      throw new Error("Host B disconnected");
    });
    const clients = new Map([
      ["host-a", { exportAgentTranscript: exportA }],
      ["host-b", { exportAgentTranscript: exportB }],
    ]);

    const result = await exportSelectedTranscripts({
      sources: [sourceA, sourceB],
      existingAttachments: [],
      getClient: (serverId) =>
        (clients.get(serverId) as unknown as DaemonClient | undefined) ?? null,
      messages,
    });

    expect(exportA).toHaveBeenCalledWith({ agentId: "agent-a", maxBytes: 128 * 1024 });
    expect(exportB).toHaveBeenCalledWith({ agentId: "agent-b", maxBytes: 128 * 1024 });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      id: "chat_history:host-a:agent-a",
      attachment: { title: "Transcript · Alpha", text: "[User] Alpha" },
      source: {
        serverId: "host-a",
        agentId: "agent-a",
        truncated: true,
        includedItemCount: 1,
      },
    });
    expect(result.attachments[0]?.source).not.toHaveProperty("itemCount");
    expect(result.successfulKeys).toEqual(
      new Set([getChatHistorySourceKey({ serverId: "host-a", agentId: "agent-a" })]),
    );
    expect(result.errorsBySource).toEqual({
      [getChatHistorySourceKey({ serverId: "host-b", agentId: "agent-b" })]: "Host B disconnected",
    });
  });

  it("reports a missing host without invoking another host's client", async () => {
    const source = agent({ id: "agent-c", serverId: "host-c" });

    const result = await exportSelectedTranscripts({
      sources: [source],
      existingAttachments: [],
      getClient: () => null,
      messages,
    });

    expect(result.attachments).toEqual([]);
    expect(result.errorsBySource).toEqual({
      [getChatHistorySourceKey({ serverId: "host-c", agentId: "agent-c" })]: "Update this host",
    });
  });

  it("enforces the five-transcript limit when a Fork transcript already exists", async () => {
    const existingSource = { serverId: "host-a", agentId: "fork-agent" };
    const sources = Array.from({ length: 5 }, (_, index) =>
      agent({ id: `agent-${index + 1}`, serverId: "host-a" }),
    );
    const exportAgentTranscript = vi.fn(async (input: { agentId: string }) =>
      transcriptResponse(`[Assistant] ${input.agentId}`),
    );

    const result = await exportSelectedTranscripts({
      sources,
      existingAttachments: [
        {
          kind: "chat_history",
          id: "chat_history:fork-draft",
          attachment: {
            type: "text",
            mimeType: "text/plain",
            contextKind: "chat_history",
            title: "Fork context",
            text: "[Assistant] Existing Fork context",
          },
          source: existingSource,
        },
      ],
      getClient: () => ({ exportAgentTranscript }) as unknown as DaemonClient,
      messages,
    });

    expect(exportAgentTranscript).toHaveBeenCalledTimes(4);
    expect(result.attachments).toHaveLength(4);
    expect(result.errorsBySource).toEqual({
      [getChatHistorySourceKey({ serverId: "host-a", agentId: "agent-5" })]: "Too many transcripts",
    });
  });
});
