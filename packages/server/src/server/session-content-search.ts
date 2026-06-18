import type { SessionContentMatch } from "@getpaseo/protocol/messages";
import {
  getMessageSearchableSegments,
  getToolCallDetailSearchableSegments,
  type SearchableSegment,
} from "@getpaseo/protocol/searchable-text";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";

const PREVIEW_RADIUS = 60;
const DEFAULT_MAX_MATCHES_PER_AGENT = 20;

export interface SessionSearchAgent {
  agentId: string;
  agentTitle: string | null;
  provider: string;
  cwd: string | null;
  timeline: readonly AgentTimelineItem[];
}

/**
 * Extract searchable segments from a daemon timeline item. The set of searchable
 * kinds is kept aligned with the client's in-session model
 * (packages/app/src/components/agent-stream-search-model.ts): messages,
 * reasoning, errors, and agent tool calls are searchable; todos and compaction
 * markers are not, so a global hit always corresponds to something the in-session
 * find can re-locate.
 */
function getTimelineItemSearchableSegments(item: AgentTimelineItem): SearchableSegment[] {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
      return getMessageSearchableSegments(item.text);
    case "error":
      return getMessageSearchableSegments(item.message);
    case "tool_call":
      return getToolCallDetailSearchableSegments(item.detail);
    case "todo":
    case "compaction":
      return [];
  }
}

/**
 * Best-effort stable id matching the client StreamItem id where it is derivable
 * (tool calls: `agent_tool_<callId>`; messages carrying a provider messageId), so
 * the client can land on the exact row. When empty, the client falls back to a
 * fresh in-session search for the query.
 */
function getTimelineItemId(item: AgentTimelineItem): string {
  if (item.type === "tool_call") {
    return `agent_tool_${item.callId}`;
  }
  if (item.type === "user_message" || item.type === "assistant_message") {
    return item.messageId ?? "";
  }
  return "";
}

function buildPreview(
  text: string,
  matchStart: number,
  matchEnd: number,
): { preview: string; previewMatchStart: number; previewMatchEnd: number } {
  const start = Math.max(0, matchStart - PREVIEW_RADIUS);
  const end = Math.min(text.length, matchEnd + PREVIEW_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const preview = `${prefix}${text.slice(start, end)}${suffix}`;
  return {
    preview,
    previewMatchStart: prefix.length + (matchStart - start),
    previewMatchEnd: prefix.length + (matchEnd - start),
  };
}

/**
 * Pure cross-session content search over already-loaded timelines. Uses the same
 * case-insensitive substring algorithm as the client's findAgentStreamSearchMatches
 * and emits at most one match per timeline item (enough to navigate to it).
 */
export function searchSessionContent(input: {
  agents: readonly SessionSearchAgent[];
  query: string;
  limit?: number;
  maxMatchesPerAgent?: number;
}): SessionContentMatch[] {
  const normalizedQuery = input.query.toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const limit = input.limit && input.limit > 0 ? input.limit : Number.POSITIVE_INFINITY;
  const maxPerAgent =
    input.maxMatchesPerAgent && input.maxMatchesPerAgent > 0
      ? input.maxMatchesPerAgent
      : DEFAULT_MAX_MATCHES_PER_AGENT;

  const results: SessionContentMatch[] = [];
  for (const agent of input.agents) {
    let perAgentCount = 0;
    for (let index = 0; index < agent.timeline.length; index += 1) {
      if (results.length >= limit) {
        return results;
      }
      if (perAgentCount >= maxPerAgent) {
        break;
      }
      const item = agent.timeline[index];
      const match = firstSegmentMatch(item, normalizedQuery, input.query.length);
      if (!match) {
        continue;
      }
      const preview = buildPreview(match.segment.text, match.start, match.end);
      results.push({
        agentId: agent.agentId,
        agentTitle: agent.agentTitle,
        provider: agent.provider,
        cwd: agent.cwd,
        itemId: getTimelineItemId(item),
        itemKind: item.type,
        segmentKey: match.segment.key,
        preview: preview.preview,
        previewMatchStart: preview.previewMatchStart,
        previewMatchEnd: preview.previewMatchEnd,
        seq: index,
      });
      perAgentCount += 1;
    }
  }
  return results;
}

function firstSegmentMatch(
  item: AgentTimelineItem,
  normalizedQuery: string,
  queryLength: number,
): { segment: SearchableSegment; start: number; end: number } | null {
  for (const segment of getTimelineItemSearchableSegments(item)) {
    const start = segment.text.toLocaleLowerCase().indexOf(normalizedQuery);
    if (start >= 0) {
      return { segment, start, end: start + queryLength };
    }
  }
  return null;
}
