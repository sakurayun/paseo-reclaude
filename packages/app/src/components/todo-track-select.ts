import type { StreamItem, TodoEntry } from "@/types/stream";

/**
 * Returns the agent's most recent todo list from the stream. Tail holds the
 * newest items, so it is scanned first (back to front); head holds the older
 * history loaded above it.
 */
export function selectLatestTodoItems(
  lists: Array<ReadonlyArray<StreamItem> | undefined>,
): TodoEntry[] | null {
  for (const list of lists) {
    if (!list) continue;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index];
      if (item && item.kind === "todo_list") {
        return item.items;
      }
    }
  }
  return null;
}
