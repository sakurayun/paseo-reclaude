import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  buildChatHistoryAttachmentId,
  getChatHistorySourceKey,
} from "@/attachments/chat-history-identity";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  MAX_DRAFT_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_ATTACHMENTS,
  MAX_TRANSCRIPT_BYTES,
  selectTranscriptCandidatesWithinLimit,
  settleWithConcurrency,
  textByteLength,
  TRANSCRIPT_EXPORT_CONCURRENCY,
} from "@/components/add-transcripts-sheet-view-model";

type TranscriptExportClient = Pick<DaemonClient, "exportAgentTranscript">;
type TextAgentAttachment = Extract<AgentAttachment, { type: "text" }>;

interface SuccessfulTranscriptExport {
  source: AggregatedAgent;
  attachment: TextAgentAttachment;
  totalItemCount: number | null;
  includedItemCount: number;
  byteCount: number;
  truncated: boolean;
  capturedCursor: { epoch: string; seq: number } | null;
}

export interface AddTranscriptsExportMessages {
  updateHost: string;
  unavailable: string;
  exportFailed: string;
  totalTooLarge: string;
  maximumSelected: string;
  attachmentTitle: (sourceTitle: string) => string;
}

export interface AddTranscriptsExportResult {
  attachments: ChatHistoryContextAttachment[];
  errorsBySource: Record<string, string>;
  successfulKeys: Set<string>;
}

function resolveAgentTitle(agent: AggregatedAgent): string {
  return (
    agent.title?.trim() || agent.projectPlacement?.workspaceName?.trim() || agent.cwd || agent.id
  );
}

function resolveWorkspaceLabel(agent: AggregatedAgent): string {
  return agent.projectPlacement?.workspaceName?.trim() || agent.cwd;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function resolveTranscriptByteCount(input: { text: string; reportedByteCount?: number }): number {
  return Math.max(input.reportedByteCount ?? 0, textByteLength(input.text));
}

function getExistingByteCount(
  attachments: readonly ChatHistoryContextAttachment[],
): Map<string, number> {
  return new Map(
    attachments.map((attachment) => [
      getChatHistorySourceKey(attachment.source),
      resolveTranscriptByteCount({
        text: attachment.attachment.text,
        reportedByteCount: attachment.source.byteCount,
      }),
    ]),
  );
}

function resolveTranscriptExportClient(value: DaemonClient | null): TranscriptExportClient | null {
  return value && typeof value.exportAgentTranscript === "function" ? value : null;
}

/**
 * Export selected sources before mutating the draft. Results stay source-keyed
 * so one host failure cannot discard successful snapshots from other hosts.
 */
export async function exportSelectedTranscripts(input: {
  sources: readonly AggregatedAgent[];
  existingAttachments: readonly ChatHistoryContextAttachment[];
  getClient: (serverId: string) => DaemonClient | null;
  messages: AddTranscriptsExportMessages;
}): Promise<AddTranscriptsExportResult> {
  const errorsBySource: Record<string, string> = {};
  const admittedSourceKeys = new Set(
    input.existingAttachments.map((attachment) => getChatHistorySourceKey(attachment.source)),
  );
  const queuedSourceKeys = new Set<string>();
  const sources = input.sources.filter((source) => {
    const key = getChatHistorySourceKey({ serverId: source.serverId, agentId: source.id });
    if (queuedSourceKeys.has(key)) {
      return false;
    }
    queuedSourceKeys.add(key);
    if (!admittedSourceKeys.has(key) && admittedSourceKeys.size >= MAX_TRANSCRIPT_ATTACHMENTS) {
      errorsBySource[key] = input.messages.maximumSelected;
      return false;
    }
    admittedSourceKeys.add(key);
    return true;
  });
  const results = await settleWithConcurrency({
    values: sources,
    limit: TRANSCRIPT_EXPORT_CONCURRENCY,
    task: async (source): Promise<SuccessfulTranscriptExport> => {
      const client = resolveTranscriptExportClient(input.getClient(source.serverId));
      if (!client) {
        throw new Error(input.messages.updateHost);
      }
      const response = await client.exportAgentTranscript({
        agentId: source.id,
        maxBytes: MAX_TRANSCRIPT_BYTES,
      });
      if (!response.attachment) {
        throw new Error(response.error ?? input.messages.unavailable);
      }
      return {
        source,
        attachment: response.attachment,
        totalItemCount: response.totalItemCount,
        includedItemCount: response.includedItemCount,
        byteCount: response.byteCount,
        truncated: response.truncated,
        capturedCursor: response.capturedCursor,
      };
    },
  });

  const validExportsByKey = new Map<
    string,
    { value: SuccessfulTranscriptExport; byteCount: number }
  >();

  for (const [index, result] of results.entries()) {
    const source = sources[index];
    if (!source) {
      continue;
    }
    const key = getChatHistorySourceKey({ serverId: source.serverId, agentId: source.id });
    if (result.status === "rejected") {
      errorsBySource[key] = resolveErrorMessage(result.reason, input.messages.exportFailed);
      continue;
    }
    const byteCount = resolveTranscriptByteCount({
      text: result.value.attachment.text,
      reportedByteCount: result.value.byteCount,
    });
    if (byteCount > MAX_TRANSCRIPT_BYTES) {
      errorsBySource[key] = input.messages.totalTooLarge;
      continue;
    }
    validExportsByKey.set(key, { value: result.value, byteCount });
  }

  const sizePlan = selectTranscriptCandidatesWithinLimit({
    existingByteCountBySource: getExistingByteCount(input.existingAttachments),
    candidates: sources.flatMap((source) => {
      const key = getChatHistorySourceKey({ serverId: source.serverId, agentId: source.id });
      const validExport = validExportsByKey.get(key);
      return validExport ? [{ key, byteCount: validExport.byteCount }] : [];
    }),
    maxBytes: MAX_DRAFT_TRANSCRIPT_BYTES,
  });
  for (const key of sizePlan.rejectedKeys) {
    errorsBySource[key] = input.messages.totalTooLarge;
  }

  const attachments: ChatHistoryContextAttachment[] = [];
  const successfulKeys = new Set<string>();
  for (const source of sources) {
    const identity = { serverId: source.serverId, agentId: source.id };
    const key = getChatHistorySourceKey(identity);
    const validExport = validExportsByKey.get(key);
    if (!validExport || !sizePlan.acceptedKeys.has(key)) {
      continue;
    }
    attachments.push({
      kind: "chat_history",
      id: buildChatHistoryAttachmentId(identity),
      attachment: {
        ...validExport.value.attachment,
        title: input.messages.attachmentTitle(resolveAgentTitle(source)),
      },
      source: {
        ...identity,
        workspaceLabel: resolveWorkspaceLabel(source),
        serverLabel: source.serverLabel.trim() || source.serverId,
        capturedWhileRunning: source.status === "running",
        boundaryCursor: validExport.value.capturedCursor,
        ...(validExport.value.totalItemCount === null
          ? {}
          : { itemCount: validExport.value.totalItemCount }),
        includedItemCount: validExport.value.includedItemCount,
        byteCount: validExport.byteCount,
        truncated: validExport.value.truncated,
      },
    });
    successfulKeys.add(key);
  }

  return { attachments, errorsBySource, successfulKeys };
}
