import { describe, expect, it } from "vitest";
import { selectCurrentRunSidechainCalls } from "./sidechain-track-select";
import type { StreamItem } from "@/types/stream";

function userMessage(id: string): StreamItem {
  return { kind: "user_message", id, text: "go", timestamp: new Date(0) };
}

function subAgentCall(
  id: string,
  status: string,
  agentType: string,
  description: string,
): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Task",
        status,
        error: null,
        detail: { type: "sub_agent", subAgentType: agentType, description, log: "" },
      },
    },
  } as StreamItem;
}

function shellCall(id: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "ls" },
      },
    },
  } as StreamItem;
}

describe("selectCurrentRunSidechainCalls", () => {
  it("collects sub-agent calls after the last user message in stream order", () => {
    const calls = selectCurrentRunSidechainCalls([
      [
        subAgentCall("old", "completed", "Explore", "earlier run"),
        userMessage("u1"),
        subAgentCall("s1", "running", "Explore", "探索项目后端功能"),
        shellCall("sh1"),
        subAgentCall("s2", "completed", "Explore", "探索项目前端功能"),
      ],
    ]);

    expect(calls).toEqual([
      {
        id: "s1",
        agentType: "Explore",
        description: "探索项目后端功能",
        status: "running",
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "探索项目后端功能",
          log: "",
        },
      },
      {
        id: "s2",
        agentType: "Explore",
        description: "探索项目前端功能",
        status: "completed",
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "探索项目前端功能",
          log: "",
        },
      },
    ]);
  });

  it("continues into the head segment when the tail has no user message", () => {
    const calls = selectCurrentRunSidechainCalls([
      [subAgentCall("s2", "running", "Plan", "tail call")],
      [userMessage("u1"), subAgentCall("s1", "completed", "Explore", "head call")],
    ]);

    expect(calls.map((call) => call.id)).toEqual(["s1", "s2"]);
  });

  it("returns nothing when the current run has no sub-agent calls", () => {
    expect(selectCurrentRunSidechainCalls([[userMessage("u1"), shellCall("sh1")]])).toEqual([]);
  });

  it("removes a sub-agent when a task notification names it, without showing the notification", () => {
    const calls = selectCurrentRunSidechainCalls([
      [
        userMessage("u1"),
        subAgentCall("s1", "running", "Explore", "探索项目后端功能"),
        subAgentCall("s2", "running", "Explore", "探索项目前端功能"),
        taskNotification("tn1", "Background task completed: 探索项目后端功能"),
      ],
    ]);

    expect(calls.map((call) => call.id)).toEqual(["s2"]);
  });

  it("keeps sub-agents when notifications mention something else", () => {
    const calls = selectCurrentRunSidechainCalls([
      [
        userMessage("u1"),
        subAgentCall("s1", "running", "Explore", "探索项目后端功能"),
        taskNotification("tn1", "Unrelated workflow finished"),
      ],
    ]);

    expect(calls.map((call) => call.id)).toEqual(["s1"]);
  });
});

function taskNotification(id: string, label: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "task_notification",
        status: "completed",
        error: null,
        detail: { type: "plain_text", label, icon: "wrench" },
      },
    },
  } as StreamItem;
}
