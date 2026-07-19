import { describe, expect, it } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  removeSentContextAttachments,
  removeWorkspaceChatHistorySourceFromScopes,
} from "./workspace-cleanup";
import {
  mergeWorkspaceAttachments,
  selectEffectiveChatHistoryAttachments,
} from "./workspace-merge";

function chatHistoryAttachment(input?: {
  id?: string;
  serverId?: string;
  agentId?: string;
  text?: string;
}): WorkspaceComposerAttachment {
  return {
    kind: "chat_history",
    id: input?.id ?? "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: input?.text ?? "Previous chat.",
    },
    source: {
      serverId: input?.serverId ?? "local",
      agentId: input?.agentId ?? "agent-1",
    },
  };
}

function pullRequestContextAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment",
    text: "Please check this.",
  };
}

function browserElementAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com",
      selector: "button.primary",
      tag: "button",
      text: "Click me",
      outerHTML: '<button class="primary">Click me</button>',
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      reactSource: null,
      parentChain: [],
      children: [],
      formatted: "button.primary\nClick me",
    },
  };
}

describe("workspace composer attachment cleanup", () => {
  it("clears sent scoped context attachments from their stores", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    const pullRequestContext = pullRequestContextAttachment();
    const browserElement = browserElementAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory, pullRequestContext, browserElement],
    });

    removeSentContextAttachments([chatHistory, pullRequestContext, browserElement]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });

  it("prefers a durable transcript snapshot over Fork context from the same source", () => {
    const persistent = chatHistoryAttachment({
      id: "chat_history:source-host:source-agent",
      serverId: "source-host",
      agentId: "source-agent",
      text: "Full persisted transcript.",
    });
    const forkContext = chatHistoryAttachment({
      id: "chat_history:draft-1",
      serverId: "source-host",
      agentId: "source-agent",
      text: "Fork through selected turn.",
    });
    const anotherSource = chatHistoryAttachment({
      id: "chat_history:other-host:other-agent",
      serverId: "other-host",
      agentId: "other-agent",
    });
    const duplicateScopedSource = chatHistoryAttachment({
      id: "chat_history:second-scoped-copy",
      serverId: "other-host",
      agentId: "other-agent",
    });

    expect(
      mergeWorkspaceAttachments({
        persistent: [persistent],
        scoped: [forkContext, anotherSource, duplicateScopedSource],
      }),
    ).toEqual([persistent, anotherSource]);
    expect(
      selectEffectiveChatHistoryAttachments({
        persistent: [persistent],
        scoped: [forkContext, anotherSource, duplicateScopedSource],
      }),
    ).toEqual([persistent, anotherSource]);
  });

  it("removes every scoped representation of a transcript source in the active draft", () => {
    resetWorkspaceAttachmentsStore();
    const draftScope = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const workspaceScope = "workspace-scope";
    const otherDraftScope = buildDraftWorkspaceAttachmentScopeKey("draft-2");
    const forkContext = chatHistoryAttachment({
      id: "chat_history:draft-1",
      serverId: "source-host",
      agentId: "source-agent",
    });
    const duplicateContext = chatHistoryAttachment({
      id: "chat_history:workspace-copy",
      serverId: "source-host",
      agentId: "source-agent",
    });
    const anotherSource = chatHistoryAttachment({
      id: "chat_history:other-source",
      serverId: "source-host",
      agentId: "other-agent",
    });
    const otherDraftCopy = chatHistoryAttachment({
      id: "chat_history:draft-2",
      serverId: "source-host",
      agentId: "source-agent",
    });
    const store = useWorkspaceAttachmentsStore.getState();
    store.setWorkspaceAttachments({ scopeKey: draftScope, attachments: [forkContext] });
    store.setWorkspaceAttachments({
      scopeKey: workspaceScope,
      attachments: [duplicateContext, anotherSource],
    });
    store.setWorkspaceAttachments({ scopeKey: otherDraftScope, attachments: [otherDraftCopy] });

    removeWorkspaceChatHistorySourceFromScopes({
      source: { serverId: "source-host", agentId: "source-agent" },
      scopeKeys: [draftScope, workspaceScope],
    });

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[draftScope]).toBeUndefined();
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[workspaceScope]).toEqual([
      anotherSource,
    ]);
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[otherDraftScope]).toEqual([
      otherDraftCopy,
    ]);
  });
});
