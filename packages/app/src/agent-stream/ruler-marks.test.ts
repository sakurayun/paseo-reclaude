import { describe, expect, it } from "vitest";
import { assistantSummaryLabel, buildRulerMarks, type RulerMarkEntry } from "./ruler-marks";
import type { StreamItem } from "@/types/stream";

function entry(item: StreamItem, index: number): RulerMarkEntry {
  return { item, source: "liveHead", index };
}

function userMessage(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
}

function assistantMessage(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

function todoList(id: string): StreamItem {
  return {
    kind: "todo_list",
    id,
    timestamp: new Date(0),
    provider: "claude",
    items: [{ text: "First task", completed: false }],
  };
}

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

describe("assistantSummaryLabel", () => {
  it("prefers the first markdown heading", () => {
    expect(assistantSummaryLabel("intro line\n\n## Fix applied\nmore text")).toBe("Fix applied");
  });

  it("falls back to the first non-empty line", () => {
    expect(assistantSummaryLabel("\n\nAll done here.\nsecond line")).toBe("All done here.");
  });
});

describe("buildRulerMarks", () => {
  it("marks user messages, turn ends, todos and notifications in order", () => {
    const marks = buildRulerMarks([
      entry(userMessage("u1", "请帮我修 bug"), 0),
      entry(todoList("td1"), 1),
      entry(taskNotification("tn1", "Background task completed"), 2),
      entry(assistantMessage("a1", "中间汇报"), 3),
      entry(assistantMessage("a2", "# 修复完成\n详情……"), 4),
      entry(userMessage("u2", "继续优化"), 5),
      entry(assistantMessage("a3", "好的，开始优化"), 6),
    ]);

    expect(marks.map((mark) => ({ id: mark.id, kind: mark.kind, label: mark.label }))).toEqual([
      { id: "u1", kind: "user", label: "请帮我修 bug" },
      { id: "td1", kind: "todo", label: "First task" },
      { id: "tn1", kind: "notification", label: "Background task completed" },
      { id: "a2", kind: "turn-end", label: "修复完成" },
      { id: "u2", kind: "user", label: "继续优化" },
      { id: "a3", kind: "turn-end", label: "好的，开始优化" },
    ]);
  });

  it("returns no marks for an empty stream", () => {
    expect(buildRulerMarks([])).toEqual([]);
  });
});
