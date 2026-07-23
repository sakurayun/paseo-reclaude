import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import {
  encodeGrokSessionCwd,
  listGrokImportableSessions,
  readGrokImportSessionConfig,
  resolveGrokHomeDir,
} from "./grok-session-descriptor.js";

async function writeGrokSession(input: {
  sessionsDir: string;
  cwd: string;
  sessionId: string;
  summary: Record<string, unknown>;
  mtime?: Date;
}): Promise<string> {
  const dir = path.join(input.sessionsDir, encodeGrokSessionCwd(input.cwd), input.sessionId);
  await mkdir(dir, { recursive: true });
  const summaryPath = path.join(dir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(input.summary, null, 2)}\n`, "utf8");
  if (input.mtime) {
    await utimes(summaryPath, input.mtime, input.mtime);
    await utimes(dir, input.mtime, input.mtime);
  }
  return dir;
}

function baseSummary(input: {
  id: string;
  cwd: string;
  title?: string;
  summary?: string;
  model?: string;
  effort?: string;
  messages?: number;
  chatMessages?: number;
  updatedAt?: string;
}): Record<string, unknown> {
  return {
    info: { id: input.id, cwd: input.cwd },
    session_summary: input.summary ?? input.title ?? "hello from grok",
    generated_title: input.title ?? input.summary ?? "hello from grok",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: input.updatedAt ?? "2026-07-02T00:00:00.000Z",
    last_active_at: input.updatedAt ?? "2026-07-02T00:00:00.000Z",
    num_messages: input.messages ?? 4,
    num_chat_messages: input.chatMessages ?? 3,
    current_model_id: input.model ?? "grok-4.5",
    reasoning_effort: input.effort ?? "high",
  };
}

test("lists Grok sessions for the requested cwd and ranks by activity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-grok-sessions-"));
  const sessionsDir = path.join(root, "sessions");
  const cwd = path.join(root, "repo");
  const otherCwd = path.join(root, "other");

  await writeGrokSession({
    sessionsDir,
    cwd,
    sessionId: "older-session",
    summary: baseSummary({
      id: "older-session",
      cwd,
      title: "older title",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
    mtime: new Date("2026-07-01T00:00:00.000Z"),
  });
  await writeGrokSession({
    sessionsDir,
    cwd,
    sessionId: "newer-session",
    summary: baseSummary({
      id: "newer-session",
      cwd,
      title: "newer title",
      summary: "newer first prompt",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }),
    mtime: new Date("2026-07-10T00:00:00.000Z"),
  });
  await writeGrokSession({
    sessionsDir,
    cwd: otherCwd,
    sessionId: "other-session",
    summary: baseSummary({
      id: "other-session",
      cwd: otherCwd,
      title: "other workspace",
      updatedAt: "2026-07-20T00:00:00.000Z",
    }),
    mtime: new Date("2026-07-20T00:00:00.000Z"),
  });

  await expect(listGrokImportableSessions({ sessionsDir, cwd, limit: 10 })).resolves.toEqual([
    expect.objectContaining({
      providerHandleId: "newer-session",
      cwd,
      title: "newer title",
      firstPromptPreview: "newer first prompt",
      lastPromptPreview: "newer first prompt",
    }),
    expect.objectContaining({
      providerHandleId: "older-session",
      cwd,
      title: "older title",
    }),
  ]);
});

test("skips empty Grok sessions without chat content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-grok-empty-"));
  const sessionsDir = path.join(root, "sessions");
  const cwd = path.join(root, "repo");

  await writeGrokSession({
    sessionsDir,
    cwd,
    sessionId: "empty-session",
    summary: baseSummary({
      id: "empty-session",
      cwd,
      messages: 0,
      chatMessages: 0,
      title: "",
      summary: "",
    }),
  });
  await writeGrokSession({
    sessionsDir,
    cwd,
    sessionId: "real-session",
    summary: baseSummary({ id: "real-session", cwd, title: "real work" }),
  });

  await expect(listGrokImportableSessions({ sessionsDir, cwd })).resolves.toEqual([
    expect.objectContaining({ providerHandleId: "real-session" }),
  ]);
});

test("reads model and reasoning effort for import resume config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-grok-import-config-"));
  const sessionsDir = path.join(root, "sessions");
  const cwd = path.join(root, "repo");

  await writeGrokSession({
    sessionsDir,
    cwd,
    sessionId: "cfg-session",
    summary: baseSummary({
      id: "cfg-session",
      cwd,
      model: "grok-4.5",
      effort: "medium",
    }),
  });

  await expect(readGrokImportSessionConfig("cfg-session", { sessionsDir, cwd })).resolves.toEqual({
    model: "grok-4.5",
    thinkingOptionId: "medium",
  });
});

test("respects GROK_HOME when resolving the sessions root", () => {
  const homeDir = "/Users/example";
  expect(resolveGrokHomeDir({ homeDir, env: {} })).toBe(path.join(homeDir, ".grok"));
  expect(
    resolveGrokHomeDir({
      homeDir,
      env: { GROK_HOME: path.join(homeDir, "custom-grok") },
    }),
  ).toBe(path.join(homeDir, "custom-grok"));
});

test("encodes cwd the way Grok groups sessions on disk", () => {
  expect(encodeGrokSessionCwd("/Users/suanshu/project")).toBe("%2FUsers%2Fsuanshu%2Fproject");
});
