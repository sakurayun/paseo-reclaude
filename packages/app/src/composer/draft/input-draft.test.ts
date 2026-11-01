import { describe, expect, it } from "vitest";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import {
  areTranscriptAttachmentsEqual,
  hasDraftContent,
  resolveDraftKey,
} from "./input-draft-core";
import {
  buildDraftCommandTarget,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
} from "@/provider-selection/provider-selection";

describe("resolveDraftKey", () => {
  it("returns a string draft key unchanged", () => {
    expect(
      resolveDraftKey({
        draftKey: "draft:key",
        selectedServerId: "host-1",
      }),
    ).toBe("draft:key");
  });

  it("resolves a computed draft key from the selected server", () => {
    expect(
      resolveDraftKey({
        draftKey: ({ selectedServerId }) => `draft:${selectedServerId ?? "none"}`,
        selectedServerId: "host-1",
      }),
    ).toBe("draft:host-1");
  });
});

describe("hasDraftContent", () => {
  it("keeps a transcript-only New Agent draft", () => {
    const transcript: ChatHistoryContextAttachment = {
      kind: "chat_history",
      id: "chat_history:host-1:agent-1",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        text: "Prior architecture decisions.",
      },
      source: {
        serverId: "host-1",
        agentId: "agent-1",
      },
    };

    expect(
      hasDraftContent({
        text: "",
        attachments: [],
        transcriptAttachments: [transcript],
      }),
    ).toBe(true);
  });
});

describe("areTranscriptAttachmentsEqual", () => {
  const transcript: ChatHistoryContextAttachment = {
    kind: "chat_history",
    id: "chat_history:host-1:agent-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      text: "Prior architecture decisions.",
    },
    source: {
      serverId: "host-1",
      agentId: "agent-1",
      workspaceLabel: "main",
      serverLabel: "Mac Studio",
      capturedWhileRunning: true,
    },
  };

  it("detects provenance-only snapshot refreshes so they are persisted", () => {
    expect(
      areTranscriptAttachmentsEqual({
        left: [transcript],
        right: [
          {
            ...transcript,
            source: {
              ...transcript.source,
              workspaceLabel: "review-worktree",
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats the same persisted snapshot as equal", () => {
    expect(areTranscriptAttachmentsEqual({ left: [transcript], right: [transcript] })).toBe(true);
  });
});

describe("resolveEffectiveComposerModelId", () => {
  it("returns the selected model trimmed", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "  gpt-5.4-mini  ",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [],
        modeOptions: [],
      }),
    ).toBe("gpt-5.4-mini");
  });

  it("returns empty string when no model selected", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [],
        modeOptions: [],
      }),
    ).toBe("");
  });

  it("falls back to the provider default model when no model is selected", () => {
    expect(
      resolveEffectiveComposerModelId({
        provider: "codex",
        modelId: "",
        modeId: "",
        thinkingOptionId: "",
        availableModels: [
          { provider: "codex", id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
          { provider: "codex", id: "gpt-5.4", label: "gpt-5.4", isDefault: true },
        ],
        modeOptions: [],
      }),
    ).toBe("gpt-5.4");
  });
});

describe("resolveEffectiveComposerThinkingOptionId", () => {
  const models = [
    {
      provider: "codex",
      id: "gpt-5.4",
      label: "gpt-5.4",
      isDefault: true,
      defaultThinkingOptionId: "high",
      thinkingOptions: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
  ];

  it("prefers the selected thinking option when present", () => {
    expect(
      resolveEffectiveComposerThinkingOptionId(
        {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "",
          thinkingOptionId: "medium",
          availableModels: models,
          modeOptions: [],
        },
        "gpt-5.4",
      ),
    ).toBe("medium");
  });

  it("falls back to the model default thinking option", () => {
    expect(
      resolveEffectiveComposerThinkingOptionId(
        {
          provider: "codex",
          modelId: "gpt-5.4",
          modeId: "",
          thinkingOptionId: "",
          availableModels: models,
          modeOptions: [],
        },
        "gpt-5.4",
      ),
    ).toBe("high");
  });
});

describe("buildDraftCommandTarget", () => {
  const codexSelection = {
    provider: "codex",
    modelId: "gpt-5.4",
    modeId: "auto",
    thinkingOptionId: "high",
    availableModels: [],
    modeOptions: [{ id: "auto", label: "Auto" }],
  };

  it("needs a project when cwd is empty", () => {
    expect(
      buildDraftCommandTarget({
        selection: codexSelection,
        cwd: "  ",
        effectiveModelId: "gpt-5.4",
        effectiveThinkingOptionId: "high",
      }),
    ).toEqual({ status: "needs-project" });
  });

  it("needs a provider when none is selected", () => {
    expect(
      buildDraftCommandTarget({
        selection: { ...codexSelection, provider: null },
        cwd: "/repo",
        effectiveModelId: "",
        effectiveThinkingOptionId: "",
      }),
    ).toEqual({ status: "needs-provider" });
  });

  it("builds the draft command config from derived composer state", () => {
    expect(
      buildDraftCommandTarget({
        selection: codexSelection,
        cwd: "/repo",
        effectiveModelId: "gpt-5.4",
        effectiveThinkingOptionId: "high",
      }),
    ).toEqual({
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      },
    });
  });
});
