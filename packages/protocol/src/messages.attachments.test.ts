import { describe, expect, it } from "vitest";

import {
  AGENT_TRANSCRIPT_EXPORT_MAX_BYTES,
  AGENT_TRANSCRIPT_EXPORT_MIN_BYTES,
  AgentForkContextRequestMessageSchema,
  AgentForkContextResponseMessageSchema,
  AgentTranscriptExportRequestMessageSchema,
  AgentTranscriptExportResponseMessageSchema,
  CreateAgentRequestMessageSchema,
  CreatePaseoWorktreeRequestSchema,
  SendAgentMessageRequestSchema,
} from "./messages.js";

describe("shared messages attachments", () => {
  it("preserves an optional timeline cursor on fork-context messages", () => {
    const boundaryCursor = { epoch: "timeline-1", seq: 42 };
    const request = AgentForkContextRequestMessageSchema.parse({
      type: "agent.fork_context.request",
      agentId: "agent-1",
      requestId: "fork-1",
      boundaryCursor,
    });
    const response = AgentForkContextResponseMessageSchema.parse({
      type: "agent.fork_context.response",
      payload: {
        requestId: "fork-1",
        agentId: "agent-1",
        attachment: null,
        itemCount: 2,
        boundaryMessageId: null,
        boundaryCursor,
        error: null,
      },
    });

    expect(request.boundaryCursor).toEqual(boundaryCursor);
    expect(response.payload.boundaryCursor).toEqual(boundaryCursor);
  });

  it("accepts a legacy fork-context response without a timeline cursor", () => {
    expect(
      AgentForkContextResponseMessageSchema.parse({
        type: "agent.fork_context.response",
        payload: {
          requestId: "fork-1",
          agentId: "agent-1",
          attachment: null,
          itemCount: 2,
          boundaryMessageId: "assistant-1",
          error: null,
        },
      }).payload.boundaryCursor,
    ).toBeUndefined();
  });

  it("validates bounded transcript export messages", () => {
    const capturedCursor = { epoch: "timeline-2", seq: 84 };
    const request = AgentTranscriptExportRequestMessageSchema.parse({
      type: "agent.transcript.export.request",
      agentId: "agent-2",
      maxBytes: 4096,
      requestId: "transcript-1",
    });
    const response = AgentTranscriptExportResponseMessageSchema.parse({
      type: "agent.transcript.export.response",
      payload: {
        requestId: "transcript-1",
        agentId: "agent-2",
        attachment: {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          title: "Chat history",
          text: "<chat-history-summary>\nsummary\n</chat-history-summary>",
        },
        totalItemCount: 8,
        includedItemCount: 3,
        byteCount: 512,
        truncated: true,
        capturedCursor,
        error: null,
      },
    });

    expect(request.maxBytes).toBe(4096);
    expect(response.payload).toMatchObject({
      totalItemCount: 8,
      includedItemCount: 3,
      byteCount: 512,
      truncated: true,
      capturedCursor,
      attachment: { contextKind: "chat_history" },
    });
    expect(
      AgentTranscriptExportRequestMessageSchema.parse({
        type: "agent.transcript.export.request",
        agentId: "agent-2",
        maxBytes: AGENT_TRANSCRIPT_EXPORT_MAX_BYTES + 1,
        requestId: "future-policy",
      }).maxBytes,
    ).toBe(AGENT_TRANSCRIPT_EXPORT_MAX_BYTES + 1);
    expect(
      AgentTranscriptExportRequestMessageSchema.parse({
        type: "agent.transcript.export.request",
        agentId: "agent-2",
        maxBytes: AGENT_TRANSCRIPT_EXPORT_MIN_BYTES - 1,
        requestId: "smaller-policy",
      }).maxBytes,
    ).toBe(AGENT_TRANSCRIPT_EXPORT_MIN_BYTES - 1);
    expect(() =>
      AgentTranscriptExportRequestMessageSchema.parse({
        type: "agent.transcript.export.request",
        agentId: "agent-2",
        maxBytes: 0,
        requestId: "invalid-zero",
      }),
    ).toThrow();
  });

  it("keeps valid review attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-review",
      agentId: "agent-1",
      text: "Please address these comments",
      attachments: [
        {
          type: "review",
          mimeType: "application/paseo-review",
          cwd: "/tmp/repo",
          mode: "base",
          baseRef: "main",
          comments: [
            {
              filePath: "src/index.ts",
              side: "new",
              lineNumber: 42,
              body: "Please guard this nullable value.",
              context: {
                hunkHeader: "@@ -40,3 +40,4 @@",
                targetLine: {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
                lines: [
                  {
                    oldLineNumber: 41,
                    newLineNumber: 41,
                    type: "context",
                    content: "const before = true;",
                  },
                  {
                    oldLineNumber: null,
                    newLineNumber: 42,
                    type: "add",
                    content: "const value = maybeNull.name;",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "review",
        mimeType: "application/paseo-review",
        cwd: "/tmp/repo",
        mode: "base",
        baseRef: "main",
        comments: [
          {
            filePath: "src/index.ts",
            side: "new",
            lineNumber: 42,
            body: "Please guard this nullable value.",
            context: {
              hunkHeader: "@@ -40,3 +40,4 @@",
              targetLine: {
                oldLineNumber: null,
                newLineNumber: 42,
                type: "add",
                content: "const value = maybeNull.name;",
              },
              lines: [
                {
                  oldLineNumber: 41,
                  newLineNumber: 41,
                  type: "context",
                  content: "const before = true;",
                },
                {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it("drops malformed review attachments while keeping valid attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-bad-review",
      agentId: "agent-1",
      text: "Review",
      attachments: [
        {
          type: "review",
          mimeType: "application/paseo-review",
          cwd: "/tmp/repo",
          mode: "uncommitted",
          comments: [
            {
              filePath: "src/index.ts",
              side: "new",
              lineNumber: "42",
              body: "This line number is malformed.",
              context: {
                hunkHeader: "@@ -40,3 +40,4 @@",
                targetLine: {
                  oldLineNumber: null,
                  newLineNumber: 42,
                  type: "add",
                  content: "const value = maybeNull.name;",
                },
                lines: [],
              },
            },
          ],
        },
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/getpaseo/paseo/issues/55",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Improve startup error details",
        url: "https://github.com/getpaseo/paseo/issues/55",
      },
    ]);
  });

  it("keeps known attachments and drops unknown create-agent attachments", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-1",
      config: {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      initialPrompt: "Review this PR",
      attachments: [
        {
          type: "github_pr",
          mimeType: "application/github-pr",
          number: 123,
          title: "Fix race in worktree setup",
          url: "https://github.com/getpaseo/paseo/pull/123",
          body: "Body",
          baseRefName: "main",
          headRefName: "fix/worktree-race",
        },
        {
          type: "future_attachment",
          mimeType: "application/future",
          foo: "bar",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 123,
        title: "Fix race in worktree setup",
        url: "https://github.com/getpaseo/paseo/pull/123",
        body: "Body",
        baseRefName: "main",
        headRefName: "fix/worktree-race",
      },
    ]);
  });

  it("keeps known attachments and drops unknown send-message attachments", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-2",
      agentId: "agent-1",
      text: "Review",
      attachments: [
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/getpaseo/paseo/issues/55",
          body: "Body",
        },
        {
          type: "future_attachment",
          mimeType: "application/future",
          foo: "bar",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Improve startup error details",
        url: "https://github.com/getpaseo/paseo/issues/55",
        body: "Body",
      },
    ]);
  });

  it("keeps known text attachment context kinds and ignores future ones", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-text-context",
      agentId: "agent-1",
      text: "Continue",
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          title: "Chat history",
          text: "Earlier context",
        },
        {
          type: "text",
          mimeType: "text/plain",
          contextKind: "future_context",
          title: "Future context",
          text: "Future client hint",
        },
      ],
    });

    expect(parsed.attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "Chat history",
        text: "Earlier context",
      },
      {
        type: "text",
        mimeType: "text/plain",
        title: "Future context",
        text: "Future client hint",
      },
    ]);
  });

  it("keeps known firstAgentContext attachments and drops unknown ones", () => {
    const parsed = CreatePaseoWorktreeRequestSchema.parse({
      type: "create_paseo_worktree_request",
      requestId: "req-3",
      cwd: "/tmp/repo",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_pr",
            mimeType: "application/github-pr",
            number: 99,
            title: "Fork-safe PR checkout",
            url: "https://github.com/getpaseo/paseo/pull/99",
          },
          {
            type: "future_attachment",
            mimeType: "application/future",
            foo: "bar",
          },
        ],
      },
    });

    expect(parsed.firstAgentContext?.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 99,
        title: "Fork-safe PR checkout",
        url: "https://github.com/getpaseo/paseo/pull/99",
      },
    ]);
    expect(parsed.firstAgentContext?.prompt).toBe("Investigate flaky test");
  });

  it("parses worktree-create payloads without a firstAgentContext", () => {
    const parsed = CreatePaseoWorktreeRequestSchema.parse({
      type: "create_paseo_worktree_request",
      requestId: "req-4",
      cwd: "/tmp/repo",
    });

    expect(parsed).toEqual({
      type: "create_paseo_worktree_request",
      requestId: "req-4",
      cwd: "/tmp/repo",
    });
  });

  it("accepts and strips create-worktree intent fields compatibly", () => {
    const parsed = CreatePaseoWorktreeRequestSchema.parse({
      type: "create_paseo_worktree_request",
      requestId: "req-5",
      cwd: "/tmp/repo",
      action: "checkout",
      refName: "feature/ref-picker",
      githubPrNumber: 42,
      futureField: "ignored",
    });

    expect(parsed).toEqual({
      type: "create_paseo_worktree_request",
      requestId: "req-5",
      cwd: "/tmp/repo",
      action: "checkout",
      refName: "feature/ref-picker",
      githubPrNumber: 42,
    });
  });

  it("accepts optional create-agent git intent fields and strips unknown git fields", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-6",
      config: {
        provider: "codex",
        cwd: "/tmp/repo",
      },
      attachments: [],
      git: {
        createWorktree: true,
        worktreeSlug: "review-42",
        action: "checkout",
        refName: "head-ref",
        githubPrNumber: 42,
        futureGitField: "ignored",
      },
    });

    expect(parsed.git).toEqual({
      createWorktree: true,
      worktreeSlug: "review-42",
      action: "checkout",
      refName: "head-ref",
      githubPrNumber: 42,
    });
  });
});
