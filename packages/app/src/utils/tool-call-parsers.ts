import { z } from "zod";
import type { HighlightToken } from "@getpaseo/highlight";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  segments?: DiffSegment[];
  // Syntax-highlight tokens for the code on this line (prefix char excluded),
  // attached by highlightDiffLines when the file's language is supported.
  tokens?: HighlightToken[];
}

function splitIntoLines(text: string): string[] {
  if (!text) {
    return [];
  }

  return text.replace(/\r\n/g, "\n").split("\n");
}

function splitIntoWords(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inWord = false;

  for (const char of text) {
    const isWordChar = /\w/.test(char);
    if (isWordChar) {
      if (!inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = true;
      current += char;
    } else {
      if (inWord && current) {
        result.push(current);
        current = "";
      }
      inWord = false;
      current += char;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function computeWordLevelDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } {
  const oldWords = splitIntoWords(oldLine);
  const newWords = splitIntoWords(newLine);

  const m = oldWords.length;
  const n = newWords.length;

  // LCS to find common words
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Mark which words are in LCS (unchanged)
  const oldInLCS = new Set<number>();
  const newInLCS = new Set<number>();

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      oldInLCS.add(i);
      newInLCS.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  // Build segments: consecutive unchanged or changed words merged
  const buildSegments = (words: string[], inLCS: Set<number>): DiffSegment[] => {
    if (words.length === 0) return [];

    const segments: DiffSegment[] = [];
    let currentText = "";
    let currentChanged: boolean | null = null;

    for (let idx = 0; idx < words.length; idx++) {
      const word = words[idx];
      const changed = !inLCS.has(idx);

      if (currentChanged === null) {
        currentText = word;
        currentChanged = changed;
      } else if (changed === currentChanged) {
        currentText += word;
      } else {
        segments.push({ text: currentText, changed: currentChanged });
        currentText = word;
        currentChanged = changed;
      }
    }

    if (currentText) {
      segments.push({ text: currentText, changed: currentChanged ?? false });
    }

    return segments;
  };

  const oldSegments = buildSegments(oldWords, oldInLCS);
  const newSegments = buildSegments(newWords, newInLCS);

  return {
    oldSegments,
    newSegments,
  };
}

export function buildLineDiff(originalText: string, updatedText: string): DiffLine[] {
  const originalLines = splitIntoLines(originalText);
  const updatedLines = splitIntoLines(updatedText);

  const hasAnyContent = originalLines.length > 0 || updatedLines.length > 0;
  if (!hasAnyContent) {
    return [];
  }

  const m = originalLines.length;
  const n = updatedLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (originalLines[i] === updatedLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (originalLines[i] === updatedLines[j]) {
      diff.push({ type: "context", content: ` ${originalLines[i]}` });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", content: `-${originalLines[i]}` });
      i += 1;
    } else {
      diff.push({ type: "add", content: `+${updatedLines[j]}` });
      j += 1;
    }
  }

  while (i < m) {
    diff.push({ type: "remove", content: `-${originalLines[i]}` });
    i += 1;
  }

  while (j < n) {
    diff.push({ type: "add", content: `+${updatedLines[j]}` });
    j += 1;
  }

  // Post-process to add word-level segments for adjacent remove/add pairs
  for (let idx = 0; idx < diff.length - 1; idx++) {
    const curr = diff[idx];
    const next = diff[idx + 1];

    if (curr.type === "remove" && next.type === "add") {
      // Strip the leading -/+ from content for comparison
      const oldLineText = curr.content.slice(1);
      const newLineText = next.content.slice(1);

      const { oldSegments, newSegments } = computeWordLevelDiff(oldLineText, newLineText);
      curr.segments = oldSegments;
      next.segments = newSegments;
    }
  }

  return diff;
}

export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  if (!diffText) {
    return [];
  }

  const lines = splitIntoLines(diffText);
  const diff: DiffLine[] = [];

  for (const line of lines) {
    if (!line.length) {
      diff.push({ type: "context", content: line });
      continue;
    }

    if (line.startsWith("@@")) {
      diff.push({ type: "header", content: line });
      continue;
    }

    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) {
        diff.push({ type: "add", content: line });
      }
      continue;
    }

    if (line.startsWith("-")) {
      if (!line.startsWith("---")) {
        diff.push({ type: "remove", content: line });
      }
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    if (line.startsWith("\\ No newline")) {
      diff.push({ type: "header", content: line });
      continue;
    }

    diff.push({ type: "context", content: line });
  }

  return diff;
}

// ---- Task Extraction (cross-provider) ----

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskEntry {
  text: string;
  status: TaskStatus;
  completed: boolean;
}

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const ClaudeTodoWriteSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      status: TaskStatusSchema,
      activeForm: z.string().optional(),
    }),
  ),
});

const UpdatePlanSchema = z.object({
  plan: z.array(
    z.object({
      step: z.string(),
      status: TaskStatusSchema.catch("pending"),
    }),
  ),
});

function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[.\s-]+/g, "_")
    .toLowerCase();
}

export function extractTaskEntriesFromToolCall(
  toolName: string,
  input: unknown,
): TaskEntry[] | null {
  const normalized = normalizeToolName(toolName);

  // Claude's plan mode uses ExitPlanMode for the approval prompt; it is not a task list.
  if (normalized === "exitplanmode") {
    return null;
  }

  if (normalized === "todowrite" || normalized === "todo_write") {
    const parsed = ClaudeTodoWriteSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.todos.map((todo) => {
      const status = todo.status;
      const text = todo.activeForm?.trim() || todo.content.trim();
      return {
        text: text.length ? text : todo.content,
        status,
        completed: status === "completed",
      };
    });
  }

  if (normalized === "update_plan") {
    const parsed = UpdatePlanSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.plan
      .map((entry) => ({
        text: entry.step.trim(),
        status: entry.status,
        completed: entry.status === "completed",
      }))
      .filter((entry) => entry.text.length > 0);
  }

  return null;
}

// ---- Anthropic Tasks system (TaskCreate / TaskUpdate / TaskList / TaskGet) ----
//
// Unlike TodoWrite, which resends the full todo list on every call, the Tasks
// tools are incremental: TaskCreate adds one task, TaskUpdate mutates one task
// by id, and TaskList reports the authoritative list in its output. The stream
// reducer accumulates these effects into the same todo_list checklist items
// that TodoWrite produces.

export interface TaskChecklistEntry {
  /** Task id from the Tasks system, used to match later TaskUpdate calls. */
  sourceId?: string;
  text: string;
  completed: boolean;
}

export type TaskToolKind = "create" | "update" | "list" | "get";

export function resolveTaskToolKind(toolName: string): TaskToolKind | null {
  switch (normalizeToolName(toolName)) {
    case "taskcreate":
    case "task_create":
      return "create";
    case "taskupdate":
    case "task_update":
      return "update";
    case "tasklist":
    case "task_list":
      return "list";
    case "taskget":
    case "task_get":
      return "get";
    default:
      return null;
  }
}

const TaskCreateInputSchema = z.object({
  subject: z.string(),
  activeForm: z.string().optional(),
});

const TaskUpdateStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"]);

const TaskUpdateInputSchema = z.object({
  taskId: z.union([z.string(), z.number().transform((value) => String(value))]),
  status: TaskUpdateStatusSchema.optional(),
  subject: z.string().optional(),
});

export type TaskToolCallEffect =
  | { kind: "upsert"; taskId: string | null; text: string }
  | {
      kind: "update";
      taskId: string;
      status?: z.infer<typeof TaskUpdateStatusSchema>;
      text?: string;
    }
  | { kind: "replace"; entries: TaskChecklistEntry[] };

/** Flattens tool output shapes (string, content blocks, {output}) to text. */
function collectOutputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => collectOutputText(entry))
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "output", "content"]) {
      if (record[key] !== undefined) {
        const text = collectOutputText(record[key]);
        if (text) {
          return text;
        }
      }
    }
  }
  return "";
}

// TaskCreate output looks like: "Task #12 created successfully: <subject>".
function readTaskIdFromCreateOutput(output: unknown): string | null {
  const match = collectOutputText(output).match(/task\s+#(\S+)\s+created/i);
  return match?.[1] ?? null;
}

// TaskList output lines look like: "#12 [in_progress] <subject>".
const TASK_LIST_LINE_PATTERN = /^#(\S+)\s+\[(pending|in_progress|completed)\]\s+(.+)$/;

function parseTaskListEntries(output: unknown): TaskChecklistEntry[] | null {
  const text = collectOutputText(output);
  if (!text) {
    return null;
  }
  const entries: TaskChecklistEntry[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(TASK_LIST_LINE_PATTERN);
    if (!match) {
      continue;
    }
    const entryText = match[3]?.trim();
    if (!match[1] || !entryText) {
      continue;
    }
    entries.push({
      sourceId: match[1],
      text: entryText,
      completed: match[2] === "completed",
    });
  }
  return entries.length > 0 ? entries : null;
}

export function extractTaskToolCallEffect(
  toolName: string,
  input: unknown,
  output: unknown,
): TaskToolCallEffect | null {
  switch (resolveTaskToolKind(toolName)) {
    case "create": {
      const parsed = TaskCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        return null;
      }
      const text = parsed.data.subject.trim() || parsed.data.activeForm?.trim() || "";
      if (!text) {
        return null;
      }
      return { kind: "upsert", taskId: readTaskIdFromCreateOutput(output), text };
    }
    case "update": {
      const parsed = TaskUpdateInputSchema.safeParse(input);
      if (!parsed.success) {
        return null;
      }
      const text = parsed.data.subject?.trim();
      return {
        kind: "update",
        taskId: parsed.data.taskId,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(text ? { text } : {}),
      };
    }
    case "list": {
      const entries = parseTaskListEntries(output);
      if (!entries) {
        return null;
      }
      return { kind: "replace", entries };
    }
    default:
      return null;
  }
}

export function applyTaskToolCallEffect(
  entries: ReadonlyArray<TaskChecklistEntry>,
  effect: TaskToolCallEffect,
  fallbackTaskId: string,
): TaskChecklistEntry[] {
  switch (effect.kind) {
    case "replace":
      return [...effect.entries];
    case "upsert": {
      const taskId = effect.taskId ?? fallbackTaskId;
      const index = entries.findIndex((entry) => entry.sourceId === taskId);
      if (index >= 0) {
        const next = [...entries];
        next[index] = { ...next[index]!, text: effect.text };
        return next;
      }
      return [...entries, { sourceId: taskId, text: effect.text, completed: false }];
    }
    case "update": {
      const index = entries.findIndex((entry) => entry.sourceId === effect.taskId);
      if (effect.status === "deleted") {
        return entries.filter((entry) => entry.sourceId !== effect.taskId);
      }
      if (index < 0) {
        // Updates for tasks created before this session's visible history;
        // only surface them when we at least know the subject.
        if (!effect.text) {
          return [...entries];
        }
        return [
          ...entries,
          {
            sourceId: effect.taskId,
            text: effect.text,
            completed: effect.status === "completed",
          },
        ];
      }
      const next = [...entries];
      const current = next[index]!;
      next[index] = {
        ...current,
        ...(effect.text ? { text: effect.text } : {}),
        ...(effect.status ? { completed: effect.status === "completed" } : {}),
      };
      return next;
    }
  }
}
