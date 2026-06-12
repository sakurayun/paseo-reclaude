import type { StreamItem } from "@/types/stream";
import { isAgentToolCallItem } from "@/types/stream";

export type RulerMarkKind = "user" | "turn-end" | "notification" | "todo";

export interface RulerMarkEntry {
  item: StreamItem;
  source: "historyVirtualized" | "historyMounted" | "liveHead";
  index: number;
}

export interface RulerMark {
  /** Stream item id the mark points at. */
  id: string;
  kind: RulerMarkKind;
  label: string;
  source: RulerMarkEntry["source"];
  index: number;
}

const MAX_LABEL_LENGTH = 80;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+(.+)$/m;

function truncateLabel(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_LABEL_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

/**
 * The "summary heading" of an assistant reply: its first markdown heading,
 * falling back to the first non-empty line.
 */
export function assistantSummaryLabel(text: string): string {
  const heading = text.match(MARKDOWN_HEADING_PATTERN)?.[1];
  if (heading?.trim()) {
    return truncateLabel(heading);
  }
  return truncateLabel(firstLine(text));
}

function taskNotificationLabel(item: Extract<StreamItem, { kind: "tool_call" }>): string {
  if (item.payload.source === "agent") {
    const detail = item.payload.data.detail;
    if (detail.type === "plain_text") {
      const label = detail.label?.trim();
      if (label) {
        return truncateLabel(label);
      }
    }
  }
  return "";
}

function isTaskNotificationToolCall(item: StreamItem): boolean {
  return (
    isAgentToolCallItem(item) &&
    item.payload.data.name
      .trim()
      .toLowerCase()
      .replace(/[.\s-]+/g, "_") === "task_notification"
  );
}

/**
 * Builds the ruler marks for the stream:
 * - every user message is a divider (labelled with the message text),
 * - the assistant message that ends a turn is a major divider (labelled with
 *   the reply's first heading),
 * - task notifications are minor dividers,
 * - the appearance of a todo list marks where tracked work began.
 */
export function buildRulerMarks(entries: ReadonlyArray<RulerMarkEntry>): RulerMark[] {
  const marks: RulerMark[] = [];
  let pendingTurnEnd: RulerMarkEntry | null = null;

  const flushTurnEnd = () => {
    if (!pendingTurnEnd) {
      return;
    }
    const item = pendingTurnEnd.item;
    if (item.kind === "assistant_message") {
      marks.push({
        id: item.id,
        kind: "turn-end",
        label: assistantSummaryLabel(item.text),
        source: pendingTurnEnd.source,
        index: pendingTurnEnd.index,
      });
    }
    pendingTurnEnd = null;
  };

  for (const entry of entries) {
    const item = entry.item;

    if (item.kind === "user_message") {
      flushTurnEnd();
      marks.push({
        id: item.id,
        kind: "user",
        label: truncateLabel(firstLine(item.text)),
        source: entry.source,
        index: entry.index,
      });
      continue;
    }

    if (item.kind === "assistant_message") {
      pendingTurnEnd = entry;
      continue;
    }

    if (item.kind === "todo_list") {
      marks.push({
        id: item.id,
        kind: "todo",
        label: truncateLabel(item.items[0]?.text ?? ""),
        source: entry.source,
        index: entry.index,
      });
      continue;
    }

    if (item.kind === "tool_call" && isTaskNotificationToolCall(item)) {
      marks.push({
        id: item.id,
        kind: "notification",
        label: taskNotificationLabel(item),
        source: entry.source,
        index: entry.index,
      });
    }
  }

  flushTurnEnd();
  return marks;
}
