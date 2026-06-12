import { describe, expect, it } from "vitest";

import {
  applyTaskToolCallEffect,
  buildLineDiff,
  parseUnifiedDiff,
  extractTaskEntriesFromToolCall,
  extractTaskToolCallEffect,
  resolveTaskToolKind,
} from "./tool-call-parsers";

describe("tool-call-parsers", () => {
  it("builds line diff for text changes", () => {
    const diff = buildLineDiff("old\nline\n", "new\nline\n");

    expect(diff.some((entry) => entry.type === "remove")).toBe(true);
    expect(diff.some((entry) => entry.type === "add")).toBe(true);
  });

  it("parses unified diff", () => {
    const parsed = parseUnifiedDiff("@@\n-old\n+new\n");

    expect(parsed.find((entry) => entry.type === "remove")?.content).toBe("-old");
    expect(parsed.find((entry) => entry.type === "add")?.content).toBe("+new");
  });

  it("extracts TodoWrite task entries", () => {
    const tasks = extractTaskEntriesFromToolCall("TodoWrite", {
      todos: [
        { content: "Task 1", status: "pending" },
        { content: "Task 2", status: "completed" },
      ],
    });

    expect(tasks?.map((task) => task.text)).toEqual(["Task 1", "Task 2"]);
    expect(tasks?.map((task) => task.completed)).toEqual([false, true]);
  });
});

describe("task tool call effects", () => {
  it("resolves task tool kinds from tool names", () => {
    expect(resolveTaskToolKind("TaskCreate")).toBe("create");
    expect(resolveTaskToolKind("task_update")).toBe("update");
    expect(resolveTaskToolKind("TaskList")).toBe("list");
    expect(resolveTaskToolKind("TaskGet")).toBe("get");
    expect(resolveTaskToolKind("TodoWrite")).toBeNull();
  });

  it("extracts an upsert with the task id from TaskCreate output", () => {
    const effect = extractTaskToolCallEffect(
      "TaskCreate",
      { subject: "Fix login bug", description: "details" },
      "Task #7 created successfully: Fix login bug",
    );
    expect(effect).toEqual({ kind: "upsert", taskId: "7", text: "Fix login bug" });
  });

  it("extracts an upsert with null id when output is missing", () => {
    const effect = extractTaskToolCallEffect("TaskCreate", { subject: "Do thing" }, null);
    expect(effect).toEqual({ kind: "upsert", taskId: null, text: "Do thing" });
  });

  it("extracts updates from TaskUpdate input", () => {
    expect(
      extractTaskToolCallEffect("TaskUpdate", { taskId: "7", status: "completed" }, "Updated"),
    ).toEqual({ kind: "update", taskId: "7", status: "completed" });
    expect(
      extractTaskToolCallEffect("TaskUpdate", { taskId: 7, subject: "Renamed" }, "Updated"),
    ).toEqual({ kind: "update", taskId: "7", text: "Renamed" });
  });

  it("extracts the authoritative list from TaskList output", () => {
    const effect = extractTaskToolCallEffect(
      "TaskList",
      {},
      "#1 [completed] First task\n#2 [in_progress] Second task\n#3 [pending] Third task",
    );
    expect(effect).toEqual({
      kind: "replace",
      entries: [
        { sourceId: "1", text: "First task", completed: true },
        { sourceId: "2", text: "Second task", completed: false },
        { sourceId: "3", text: "Third task", completed: false },
      ],
    });
  });

  it("accumulates create, update, delete and replace effects", () => {
    let entries = applyTaskToolCallEffect(
      [],
      { kind: "upsert", taskId: "1", text: "First" },
      "call:a",
    );
    entries = applyTaskToolCallEffect(
      entries,
      { kind: "upsert", taskId: null, text: "Second" },
      "call:b",
    );
    expect(entries).toEqual([
      { sourceId: "1", text: "First", completed: false },
      { sourceId: "call:b", text: "Second", completed: false },
    ]);

    entries = applyTaskToolCallEffect(
      entries,
      { kind: "update", taskId: "1", status: "completed" },
      "call:c",
    );
    expect(entries[0]).toEqual({ sourceId: "1", text: "First", completed: true });

    entries = applyTaskToolCallEffect(
      entries,
      { kind: "update", taskId: "call:b", status: "deleted" },
      "call:d",
    );
    expect(entries).toEqual([{ sourceId: "1", text: "First", completed: true }]);

    entries = applyTaskToolCallEffect(
      entries,
      { kind: "update", taskId: "99", status: "in_progress" },
      "call:e",
    );
    expect(entries).toEqual([{ sourceId: "1", text: "First", completed: true }]);

    entries = applyTaskToolCallEffect(
      entries,
      {
        kind: "replace",
        entries: [{ sourceId: "5", text: "Fresh", completed: false }],
      },
      "call:f",
    );
    expect(entries).toEqual([{ sourceId: "5", text: "Fresh", completed: false }]);
  });

  it("is idempotent when the same create effect is applied twice", () => {
    const first = applyTaskToolCallEffect(
      [],
      { kind: "upsert", taskId: "1", text: "Once" },
      "call:a",
    );
    const second = applyTaskToolCallEffect(
      first,
      { kind: "upsert", taskId: "1", text: "Once" },
      "call:a",
    );
    expect(second).toEqual(first);
  });
});
