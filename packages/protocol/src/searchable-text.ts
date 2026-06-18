import type { ToolCallDetail } from "./agent-types.js";

/**
 * A unit of searchable text extracted from a timeline item.
 *
 * `key` identifies which logical text region (and therefore which render
 * sub-region) the segment belongs to. For plain messages there is a single
 * `"text"` region spanning the whole message; for tool calls each detail field
 * (command, output, diff, …) is its own region so find-highlights can be routed
 * back to the matching part of the structured renderer.
 *
 * `startOffset` is the segment's offset within the logical text space its `key`
 * represents. Callers compute absolute match offsets as `startOffset + index`,
 * so highlights map cleanly onto the rendered text for that region.
 *
 * This module is shared between the client (in-session find) and the daemon
 * (cross-session search) so both sides extract identical text with identical
 * offsets — see packages/app/src/components/agent-stream-search-model.ts and the
 * daemon session-content search handler.
 */
export interface SearchableSegment {
  key: string;
  text: string;
  startOffset: number;
}

/**
 * Searchable segments for a plain markdown/text body (user, assistant, thought,
 * activity messages). The entire body — including fenced/indented code blocks,
 * which the legacy in-session model deliberately skipped — is searchable as one
 * region so that file contents pasted into code blocks can be found and
 * highlighted against the original message string.
 */
export function getMessageSearchableSegments(text: string): SearchableSegment[] {
  if (!text) {
    return [];
  }
  return [{ key: "text", text, startOffset: 0 }];
}

function appendSegment(
  segments: SearchableSegment[],
  key: string,
  text: string | undefined | null,
) {
  if (typeof text === "string" && text.length > 0) {
    segments.push({ key, text, startOffset: 0 });
  }
}

function appendListSegment<T>(
  segments: SearchableSegment[],
  key: string,
  values: readonly T[] | undefined,
  format: (value: T) => string,
) {
  if (values && values.length > 0) {
    appendSegment(segments, key, values.map(format).join("\n"));
  }
}

function stringifyUnknownValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Searchable segments for a tool call, one per meaningful detail field. Keys are
 * stable (`shell.command`, `edit.diff`, `read.content`, …) and form the contract
 * the renderer uses to dispatch highlights to the correct sub-region.
 */
export function getToolCallDetailSearchableSegments(detail: ToolCallDetail): SearchableSegment[] {
  const segments: SearchableSegment[] = [];
  switch (detail.type) {
    case "shell":
      appendSegment(segments, "shell.command", detail.command);
      appendSegment(segments, "shell.cwd", detail.cwd);
      appendSegment(segments, "shell.output", detail.output);
      break;
    case "read":
      appendSegment(segments, "read.path", detail.filePath);
      appendSegment(segments, "read.content", detail.content);
      break;
    case "edit":
      appendSegment(segments, "edit.path", detail.filePath);
      appendSegment(segments, "edit.oldString", detail.oldString);
      appendSegment(segments, "edit.newString", detail.newString);
      appendSegment(segments, "edit.diff", detail.unifiedDiff);
      break;
    case "write":
      appendSegment(segments, "write.path", detail.filePath);
      appendSegment(segments, "write.content", detail.content);
      break;
    case "search":
      appendSegment(segments, "search.query", detail.query);
      appendSegment(segments, "search.content", detail.content);
      appendListSegment(segments, "search.files", detail.filePaths, (path) => path);
      appendListSegment(segments, "search.web", detail.webResults, (r) => `${r.title} ${r.url}`);
      appendListSegment(segments, "search.annotations", detail.annotations, (a) => a);
      break;
    case "fetch":
      appendSegment(segments, "fetch.url", detail.url);
      appendSegment(segments, "fetch.prompt", detail.prompt);
      appendSegment(segments, "fetch.result", detail.result);
      break;
    case "worktree_setup":
      appendSegment(segments, "worktree.path", detail.worktreePath);
      appendSegment(segments, "worktree.branch", detail.branchName);
      appendSegment(segments, "worktree.log", detail.log);
      appendListSegment(
        segments,
        "worktree.commands",
        detail.commands,
        (c) => `${c.command}\n${c.log}`,
      );
      break;
    case "sub_agent":
      appendSegment(segments, "subagent.description", detail.description);
      appendSegment(segments, "subagent.log", detail.log);
      appendListSegment(
        segments,
        "subagent.actions",
        detail.actions,
        (a) => `${a.toolName} ${a.summary ?? ""}`,
      );
      break;
    case "plain_text":
      appendSegment(segments, "plaintext.label", detail.label);
      appendSegment(segments, "plaintext.text", detail.text);
      break;
    case "plan":
      appendSegment(segments, "plan.text", detail.text);
      break;
    case "unknown":
      appendSegment(segments, "unknown.input", stringifyUnknownValue(detail.input));
      appendSegment(segments, "unknown.output", stringifyUnknownValue(detail.output));
      break;
  }
  return segments;
}
