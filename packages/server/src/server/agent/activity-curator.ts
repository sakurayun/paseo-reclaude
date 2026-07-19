import { Buffer } from "node:buffer";
import {
  AGENT_TRANSCRIPT_EXPORT_MAX_BYTES,
  AGENT_TRANSCRIPT_EXPORT_MIN_BYTES,
  type AgentAttachment,
} from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { isLikelyExternalToolName } from "@getpaseo/protocol/tool-name-normalization";
import { buildToolCallDisplayModel } from "@getpaseo/protocol/tool-call-display";
import { projectTimelineRows } from "./timeline-projection.js";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;

interface ActivityCuratorOptions {
  maxItems?: number;
  labelAssistantMessages?: boolean;
  includeKinds?: readonly AgentTimelineItem["type"][];
  includeExternalToolInput?: boolean;
  includeToolSummary?: boolean;
  includeSubAgentLog?: boolean;
  portableToolMarkersOnly?: boolean;
}

interface ActivityEntry {
  text: string;
}

type TextAgentAttachment = Extract<AgentAttachment, { type: "text" }>;

function appendText(buffer: string, text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return buffer;
  }
  if (!buffer) {
    return normalized;
  }
  return `${buffer}\n${normalized}`;
}

function activityEntry(text: string): ActivityEntry {
  return { text };
}

function flushBuffers(
  entries: ActivityEntry[],
  buffers: { message: string; thought: string },
  options?: ActivityCuratorOptions,
) {
  if (buffers.message.trim()) {
    const text = buffers.message.trim();
    entries.push(activityEntry(options?.labelAssistantMessages ? `[Assistant] ${text}` : text));
  }
  if (buffers.thought.trim()) {
    const text = buffers.thought.trim();
    entries.push(activityEntry(`[Thought] ${text}`));
  }
  buffers.message = "";
  buffers.thought = "";
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) {
    return null;
  }
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) {
      return null;
    }
    if (encoded.length <= MAX_TOOL_INPUT_CHARS) {
      return encoded;
    }
    return `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_TOOL_SUMMARY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function inputFromUnknownDetail(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): unknown {
  return detail.type === "unknown" ? detail.input : null;
}

function projectForCuration(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const rows = items.map((item, index) => ({
    seq: index + 1,
    timestamp: "",
    item,
  }));
  return projectTimelineRows({ rows, mode: "projected" }).map((entry) => entry.item);
}

function shouldIncludeItem(item: AgentTimelineItem, options?: ActivityCuratorOptions): boolean {
  if (!options?.includeKinds) {
    return true;
  }
  return options.includeKinds.includes(item.type);
}

function formatToolCallEntry(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): ActivityEntry {
  const inputJson = formatToolInputJson(inputFromUnknownDetail(item.detail));
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    detail: item.detail,
    metadata: item.metadata,
  });
  const displayName = options?.portableToolMarkersOnly
    ? getPortableToolMarker(item.detail)
    : display.displayName;
  const summary = options?.includeToolSummary === false ? null : formatToolSummary(display.summary);
  if (
    (options?.includeExternalToolInput ?? true) &&
    isLikelyExternalToolName(item.name) &&
    inputJson
  ) {
    return activityEntry(`[${displayName}] ${inputJson}`);
  }
  return activityEntry(summary ? `[${displayName}] ${summary}` : `[${displayName}]`);
}

/**
 * Portable transcripts cross provider and host boundaries. Use only Paseo-owned
 * labels here: provider-supplied tool names and subagent types can contain
 * command text or other sensitive values even when raw tool input is omitted.
 */
function getPortableToolMarker(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): string {
  switch (detail.type) {
    case "shell":
      return "Shell";
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "search":
      return "Search";
    case "fetch":
      return "Fetch";
    case "worktree_setup":
      return "Worktree Setup";
    case "sub_agent":
      return "Task";
    case "plan":
      return "Plan";
    case "plain_text":
    case "unknown":
      return "Tool";
    default:
      throw new Error("unreachable");
  }
}

function appendSubAgentLog(
  entries: ActivityEntry[],
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): void {
  if (options?.includeSubAgentLog === false || item.detail.type !== "sub_agent") {
    return;
  }
  const log = item.detail.log.trim();
  if (log) {
    entries.push(activityEntry(log));
  }
}

function curateProjectedActivityEntries(
  items: readonly AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  if (items.length === 0) {
    return [];
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  const entries: ActivityEntry[] = [];
  const buffers = { message: "", thought: "" };

  for (const item of recentItems) {
    if (!shouldIncludeItem(item, options)) {
      continue;
    }

    switch (item.type) {
      case "user_message":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry(`[User] ${item.text.trim()}`));
        break;
      case "assistant_message":
        buffers.message = appendText(buffers.message, item.text);
        break;
      case "reasoning":
        buffers.thought = appendText(buffers.thought, item.text);
        break;
      case "tool_call": {
        flushBuffers(entries, buffers, options);
        entries.push(formatToolCallEntry(item, options));
        appendSubAgentLog(entries, item, options);
        break;
      }
      case "todo":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry("[Tasks]"));
        for (const entry of item.items) {
          const checkbox = entry.completed ? "[x]" : "[ ]";
          const text = `- ${checkbox} ${entry.text}`;
          entries.push(activityEntry(text));
        }
        break;
      case "error":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry(`[Error] ${item.message}`));
        break;
      case "compaction":
        flushBuffers(entries, buffers, options);
        entries.push(activityEntry("[Compacted]"));
        break;
    }
  }

  flushBuffers(entries, buffers, options);

  return entries;
}

function curateAgentActivityEntries(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  const collapsed = projectForCuration(timeline);
  return curateProjectedActivityEntries(collapsed, options);
}

/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): string {
  const entries = curateAgentActivityEntries(timeline, options);
  return entries.length > 0
    ? entries.map((entry) => entry.text).join("\n")
    : "No activity to display.";
}

interface ForkCursorBoundary {
  timelineEpoch: string;
  cursor: { epoch: string; seq: number };
}

function selectForkContextRows(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
}): {
  items: AgentTimelineItem[];
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const boundaryCursor = input.cursorBoundary?.cursor ?? null;
  const boundaryMessageId = input.boundaryMessageId?.trim() || null;
  if (!boundaryCursor && !boundaryMessageId) {
    const projected = projectTimelineRows({ rows: input.rows, mode: "projected" });
    return {
      items: projected.map((entry) => entry.item),
      boundaryCursor: null,
      boundaryMessageId: null,
    };
  }

  if (
    input.cursorBoundary &&
    input.cursorBoundary.cursor.epoch !== input.cursorBoundary.timelineEpoch
  ) {
    throw new Error("Selected timeline position is no longer available.");
  }
  const boundaryIndex = boundaryCursor
    ? input.rows.findIndex((row) => row.seq === boundaryCursor.seq)
    : input.rows.findLastIndex(
        (row) => row.item.type === "assistant_message" && row.item.messageId === boundaryMessageId,
      );
  if (boundaryIndex < 0) {
    throw new Error(
      boundaryCursor
        ? "Selected timeline position is no longer available."
        : "Selected assistant message is no longer available.",
    );
  }
  const selectedRows = input.rows.slice(0, boundaryIndex + 1);
  const projected = projectTimelineRows({ rows: selectedRows, mode: "projected" });

  return {
    items: projected.map((entry) => entry.item),
    boundaryCursor,
    boundaryMessageId,
  };
}

function trimContextMetadata(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildForkContextText(input: {
  body: string;
  agentTitle?: string | null;
  cwd?: string | null;
}): string {
  const header = buildChatHistoryHeader(input);
  return buildChatHistoryContextText({ body: input.body, header });
}

function buildChatHistoryHeader(input: {
  agentTitle?: string | null;
  cwd?: string | null;
}): string[] {
  const header = ["Chat history from a previous Paseo agent."];
  const agentTitle = trimContextMetadata(input.agentTitle);
  const cwd = trimContextMetadata(input.cwd);
  if (agentTitle) {
    header.push(`Source agent: ${agentTitle}`);
  }
  if (cwd) {
    header.push(`Source directory: ${cwd}`);
  }
  return header;
}

function buildChatHistoryContextText(input: { body: string; header: readonly string[] }): string {
  return `<chat-history-summary>\n${input.header.join("\n")}\n\n${input.body}\n</chat-history-summary>`;
}

export function buildAgentForkContextAttachment(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
}): {
  attachment: TextAgentAttachment;
  itemCount: number;
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const selected = selectForkContextRows({
    rows: input.rows,
    cursorBoundary: input.cursorBoundary,
    boundaryMessageId: input.boundaryMessageId,
  });
  const entries = curateProjectedActivityEntries(selected.items, {
    maxItems: 0,
    labelAssistantMessages: true,
    includeKinds: ["user_message", "assistant_message", "tool_call"],
    includeExternalToolInput: false,
  });
  const body =
    entries.length > 0
      ? entries.map((entry) => entry.text).join("\n")
      : "No chat history to display.";
  return {
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: buildForkContextText({
        body,
        agentTitle: input.agentTitle,
        cwd: input.cwd,
      }),
    },
    itemCount: selected.items.length,
    boundaryCursor: selected.boundaryCursor,
    boundaryMessageId: selected.boundaryMessageId,
  };
}

interface TranscriptContextEntry {
  text: string;
}

const EMPTY_TRANSCRIPT_BODY = "No chat history to display.";

function textByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Bound transcript exports at the daemon even if a caller bypasses wire validation.
 */
export function resolveAgentTranscriptExportMaxBytes(maxBytes?: number): number {
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes)) {
    return AGENT_TRANSCRIPT_EXPORT_MAX_BYTES;
  }
  return Math.min(
    AGENT_TRANSCRIPT_EXPORT_MAX_BYTES,
    Math.max(AGENT_TRANSCRIPT_EXPORT_MIN_BYTES, Math.floor(maxBytes)),
  );
}

function buildBoundedTranscriptShell(input: {
  maxBytes: number;
  agentTitle?: string | null;
  cwd?: string | null;
}): { prefix: string; suffix: string } {
  const header = ["Chat history from a previous Paseo agent."];
  const optionalHeaderLines = buildChatHistoryHeader(input).slice(1);
  const suffix = "\n</chat-history-summary>";

  for (const line of optionalHeaderLines) {
    const candidateHeader = [...header, line];
    const candidatePrefix = `<chat-history-summary>\n${candidateHeader.join("\n")}\n\n`;
    if (
      textByteLength(candidatePrefix) +
        textByteLength(EMPTY_TRANSCRIPT_BODY) +
        textByteLength(suffix) <=
      input.maxBytes
    ) {
      header.push(line);
    }
  }

  return {
    prefix: `<chat-history-summary>\n${header.join("\n")}\n\n`,
    suffix,
  };
}

function curateTranscriptEntries(items: readonly AgentTimelineItem[]): TranscriptContextEntry[] {
  return items.flatMap((item) => {
    const entries = curateProjectedActivityEntries([item], {
      labelAssistantMessages: true,
      includeKinds: ["user_message", "assistant_message", "tool_call"],
      includeExternalToolInput: false,
      includeToolSummary: false,
      includeSubAgentLog: false,
      portableToolMarkersOnly: true,
    });
    if (entries.length === 0) {
      return [];
    }
    return [{ text: entries.map((entry) => entry.text).join("\n") }];
  });
}

/**
 * Build a portable, bounded transcript snapshot from an agent timeline.
 *
 * Entries are retained as a contiguous newest suffix, so an export never cuts a
 * curated message or tool summary in half. `includedItemCount` describes
 * portable curated entries, not private reasoning or other timeline-only rows.
 * `totalItemCount` is null when the caller supplied a bounded recent window.
 */
export function buildAgentTranscriptExportAttachment(input: {
  rows: readonly AgentTimelineRow[];
  /** True when the caller intentionally supplied only a recent timeline window. */
  hasOlderRows?: boolean;
  maxBytes?: number;
  agentTitle?: string | null;
  cwd?: string | null;
}): {
  attachment: TextAgentAttachment;
  totalItemCount: number | null;
  includedItemCount: number;
  byteCount: number;
  truncated: boolean;
} {
  const selected = selectForkContextRows({ rows: input.rows });
  const entries = curateTranscriptEntries(selected.items);
  const maxBytes = resolveAgentTranscriptExportMaxBytes(input.maxBytes);
  const shell = buildBoundedTranscriptShell({
    maxBytes,
    agentTitle: input.agentTitle,
    cwd: input.cwd,
  });
  const availableBodyBytes = maxBytes - textByteLength(shell.prefix) - textByteLength(shell.suffix);
  const retainedNewestFirst: TranscriptContextEntry[] = [];
  let retainedBytes = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const separatorBytes = retainedNewestFirst.length > 0 ? textByteLength("\n") : 0;
    const nextBytes = retainedBytes + separatorBytes + textByteLength(entry.text);
    if (nextBytes > availableBodyBytes) {
      break;
    }
    retainedNewestFirst.push(entry);
    retainedBytes = nextBytes;
  }
  const retained = retainedNewestFirst.toReversed();

  const body =
    retained.length > 0 ? retained.map((entry) => entry.text).join("\n") : EMPTY_TRANSCRIPT_BODY;
  const text = `${shell.prefix}${body}${shell.suffix}`;

  return {
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text,
    },
    totalItemCount: input.hasOlderRows ? null : entries.length,
    includedItemCount: retained.length,
    byteCount: textByteLength(text),
    truncated: Boolean(input.hasOlderRows) || retained.length < entries.length,
  };
}
