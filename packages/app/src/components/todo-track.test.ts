import { describe, expect, it } from "vitest";
import { selectLatestTodoItems } from "./todo-track-select";
import type { StreamItem, TodoListItem } from "@/types/stream";

function todoListItem(id: string, items: TodoListItem["items"]): TodoListItem {
  return {
    kind: "todo_list",
    id,
    timestamp: new Date(0),
    provider: "claude",
    items,
  };
}

function assistantItem(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    timestamp: new Date(0),
    text: "hello",
  } as StreamItem;
}

describe("selectLatestTodoItems", () => {
  it("returns null when no list contains todos", () => {
    expect(selectLatestTodoItems([undefined, [assistantItem("a")]])).toBeNull();
  });

  it("returns the most recent todo list scanning from the back", () => {
    const older = todoListItem("t1", [{ text: "one", completed: false }]);
    const newer = todoListItem("t2", [
      { text: "one", completed: true },
      { text: "two", completed: false },
    ]);
    const result = selectLatestTodoItems([[older, assistantItem("a"), newer]]);
    expect(result).toEqual([
      { text: "one", completed: true },
      { text: "two", completed: false },
    ]);
  });

  it("prefers the first list (tail) over the second (head)", () => {
    const headTodos = todoListItem("head", [{ text: "old", completed: false }]);
    const tailTodos = todoListItem("tail", [{ text: "new", completed: true }]);
    const result = selectLatestTodoItems([[tailTodos], [headTodos]]);
    expect(result).toEqual([{ text: "new", completed: true }]);
  });

  it("falls back to the head when the tail has no todos", () => {
    const headTodos = todoListItem("head", [{ text: "old", completed: false }]);
    const result = selectLatestTodoItems([[assistantItem("a")], [headTodos]]);
    expect(result).toEqual([{ text: "old", completed: false }]);
  });
});
