import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem } from "@/types/stream";
import { isAgentToolCallItem } from "@/types/stream";

export type SidechainCallStatus = "running" | "completed" | "failed" | "canceled";

export interface SidechainCall {
  id: string;
  /** Agent type shown as the row title, e.g. "Explore". */
  agentType: string;
  /** The task description passed to the sub-agent. */
  description: string;
  status: SidechainCallStatus;
  /** Full sub_agent detail (activity log) for the details sheet. */
  detail: ToolCallDetail;
  errorText?: string;
}

function toSidechainCallStatus(status: string): SidechainCallStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "running";
  }
}

function toErrorText(error: unknown): string | undefined {
  if (error == null) {
    return undefined;
  }
  if (typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function toSidechainCall(item: StreamItem): SidechainCall | null {
  if (!isAgentToolCallItem(item)) {
    return null;
  }
  const data = item.payload.data;
  const errorText = toErrorText(data.error);

  if (data.detail.type !== "sub_agent") {
    return null;
  }
  return {
    id: item.id,
    agentType: data.detail.subAgentType?.trim() || data.name,
    description: data.detail.description?.trim() ?? "",
    status: toSidechainCallStatus(data.status),
    detail: data.detail,
    ...(errorText ? { errorText } : {}),
  };
}

/**
 * Text of a background task_notification tool call (workflow/teammate
 * completion notices). These are not shown as panel entries — they act as
 * the completion signal that removes the matching sub-agent row.
 */
function toTaskNotificationText(item: StreamItem): string | null {
  if (!isAgentToolCallItem(item)) {
    return null;
  }
  const data = item.payload.data;
  const normalizedName = data.name
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, "_");
  if (normalizedName !== "task_notification") {
    return null;
  }
  const parts: string[] = [];
  if (data.detail.type === "plain_text") {
    if (data.detail.label?.trim()) parts.push(data.detail.label.trim());
    if (data.detail.text?.trim()) parts.push(data.detail.text.trim());
  }
  const text = parts.join("\n");
  return text.length > 0 ? text : null;
}

function isResolvedByNotification(
  call: SidechainCall,
  notificationTexts: ReadonlyArray<string>,
): boolean {
  const description = call.description.trim().toLowerCase();
  const agentType = call.agentType.trim().toLowerCase();
  return notificationTexts.some((text) => {
    if (description.length >= 2 && text.includes(description)) {
      return true;
    }
    return agentType.length > 0 && text === agentType;
  });
}

/**
 * Collects the sidechain sub-agent tool calls of the current run: everything
 * after the last user message. Tail (newest) is scanned before head (older
 * history); within the chosen segment, calls keep stream order.
 */
export function selectCurrentRunSidechainCalls(
  lists: Array<ReadonlyArray<StreamItem> | undefined>,
): SidechainCall[] {
  const calls: SidechainCall[] = [];
  const notificationTexts: string[] = [];

  scan: for (const list of lists) {
    if (!list) continue;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index];
      if (!item) continue;
      if (item.kind === "user_message") {
        break scan;
      }
      const notificationText = toTaskNotificationText(item);
      if (notificationText) {
        notificationTexts.push(notificationText.toLowerCase());
        continue;
      }
      const call = toSidechainCall(item);
      if (call) {
        calls.unshift(call);
      }
    }
  }

  if (notificationTexts.length === 0) {
    return calls;
  }
  // A task notification naming a sub-agent means that agent's work is done
  // and reported — drop its row instead of letting it linger.
  return calls.filter((call) => !isResolvedByNotification(call, notificationTexts));
}
