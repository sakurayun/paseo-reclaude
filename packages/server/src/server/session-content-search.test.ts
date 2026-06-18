import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import { searchSessionContent, type SessionSearchAgent } from "./session-content-search.js";

function agent(
  agentId: string,
  timeline: AgentTimelineItem[],
  overrides?: Partial<SessionSearchAgent>,
): SessionSearchAgent {
  return {
    agentId,
    agentTitle: `Agent ${agentId}`,
    provider: "codex",
    cwd: `/work/${agentId}`,
    timeline,
    ...overrides,
  };
}

function userMessage(text: string, messageId?: string): AgentTimelineItem {
  return { type: "user_message", text, ...(messageId ? { messageId } : {}) };
}

function shellToolCall(callId: string, command: string, output: string): AgentTimelineItem {
  return {
    type: "tool_call",
    callId,
    name: "exec_command",
    status: "completed",
    error: null,
    detail: { type: "shell", command, output },
  };
}

describe("searchSessionContent", () => {
  it("finds matches in tool call output across loaded sessions", () => {
    const results = searchSessionContent({
      query: "needle",
      agents: [
        agent("a", [userMessage("hello world")]),
        agent("b", [shellToolCall("c1", "rg needle", "found the needle in the haystack")]),
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.agentId).toBe("b");
    expect(results[0]?.itemKind).toBe("tool_call");
    // The first searchable segment (shell.command "rg needle") matches first.
    expect(results[0]?.segmentKey).toBe("shell.command");
    expect(results[0]?.itemId).toBe("agent_tool_c1");
    expect(results[0]?.preview).toContain("needle");
  });

  it("derives best-effort itemId from messageId and leaves it empty otherwise", () => {
    const withId = searchSessionContent({
      query: "alpha",
      agents: [agent("a", [userMessage("alpha one", "msg-1")])],
    });
    expect(withId[0]?.itemId).toBe("msg-1");

    const withoutId = searchSessionContent({
      query: "alpha",
      agents: [agent("a", [userMessage("alpha two")])],
    });
    expect(withoutId[0]?.itemId).toBe("");
  });

  it("respects maxMatchesPerAgent and the global limit", () => {
    const noisy = agent("a", [
      userMessage("hit one"),
      userMessage("hit two"),
      userMessage("hit three"),
    ]);
    expect(
      searchSessionContent({ query: "hit", agents: [noisy], maxMatchesPerAgent: 2 }),
    ).toHaveLength(2);
    expect(
      searchSessionContent({
        query: "hit",
        agents: [noisy, agent("b", [userMessage("hit four")])],
        limit: 1,
      }),
    ).toHaveLength(1);
  });

  it("returns an empty list for a blank query", () => {
    expect(
      searchSessionContent({ query: "", agents: [agent("a", [userMessage("anything")])] }),
    ).toEqual([]);
  });

  it("builds a preview window with offsets pointing at the match", () => {
    const longText = `${"x".repeat(200)} TARGET ${"y".repeat(200)}`;
    const [match] = searchSessionContent({
      query: "TARGET",
      agents: [agent("a", [userMessage(longText)])],
    });
    expect(match).toBeDefined();
    expect(match?.preview.slice(match?.previewMatchStart, match?.previewMatchEnd)).toBe("TARGET");
    // Long bodies are truncated with ellipses on both sides.
    expect(match?.preview.startsWith("…")).toBe(true);
    expect(match?.preview.endsWith("…")).toBe(true);
  });
});
