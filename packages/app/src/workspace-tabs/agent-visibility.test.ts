import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  buildWorkspaceTabSnapshot,
  deriveWorkspaceAgentVisibility,
  shouldPruneWorkspaceAgentTab,
  workspaceAgentVisibilityEqual,
} from "@/workspace-tabs/agent-visibility";

function makeAgent(input: {
  id: string;
  cwd: string;
  parentAgentId?: string | null;
  archivedAt?: Date | null;
  createdAt?: Date;
  lastActivityAt?: Date;
  status?: Agent["status"];
}): Agent {
  const createdAt = input.createdAt ?? new Date("2026-03-04T00:00:00.000Z");
  const lastActivityAt = input.lastActivityAt ?? createdAt;
  return {
    serverId: "srv",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    createdAt,
    updatedAt: createdAt,
    lastUserMessageAt: null,
    lastActivityAt,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: {
      provider: "codex",
      sessionId: null,
    },
    title: null,
    cwd: input.cwd,
    model: null,
    thinkingOptionId: null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: input.archivedAt ?? null,
  };
}

describe("workspace agent visibility", () => {
  it("keeps subagents active and known while excluding them from auto-open", () => {
    const workspaceDirectory = "/repo/worktree";
    const parent = makeAgent({
      id: "parent-agent",
      cwd: workspaceDirectory,
      status: "running",
    });
    const child = makeAgent({
      id: "child-agent",
      cwd: workspaceDirectory,
      parentAgentId: "parent-agent",
      status: "running",
    });

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: new Map<string, Agent>([
        [parent.id, parent],
        [child.id, child],
      ]),
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set(["parent-agent", "child-agent"]));
    // The child is running, but subagents are never auto-opened.
    expect(result.autoOpenAgentIds).toEqual(new Set(["parent-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["parent-agent", "child-agent"]));
    expect(result.runningAgentIds).toEqual(new Set(["parent-agent", "child-agent"]));
  });

  it("excludes idle and ended root sessions from auto-open while keeping them active and known", () => {
    const workspaceDirectory = "/repo/worktree";
    const idle = makeAgent({ id: "idle-agent", cwd: workspaceDirectory, status: "idle" });
    const errored = makeAgent({ id: "error-agent", cwd: workspaceDirectory, status: "error" });
    const running = makeAgent({ id: "running-agent", cwd: workspaceDirectory, status: "running" });

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: new Map<string, Agent>([
        [idle.id, idle],
        [errored.id, errored],
        [running.id, running],
      ]),
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set(["idle-agent", "error-agent", "running-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["idle-agent", "error-agent", "running-agent"]));
    // Only the running root session auto-opens / is restored.
    expect(result.autoOpenAgentIds).toEqual(new Set(["running-agent"]));
    expect(result.runningAgentIds).toEqual(new Set(["running-agent"]));
  });

  it("keeps archived subagents known but excludes them from active and auto-open", () => {
    const workspaceDirectory = "/repo/worktree";
    const archivedChild = makeAgent({
      id: "archived-child",
      cwd: workspaceDirectory,
      parentAgentId: "parent-agent",
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
    });

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: new Map<string, Agent>([[archivedChild.id, archivedChild]]),
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set<string>());
    expect(result.autoOpenAgentIds).toEqual(new Set<string>());
    expect(result.runningAgentIds).toEqual(new Set<string>());
    expect(result.knownAgentIds).toEqual(new Set(["archived-child"]));
  });

  it("excludes a child from auto-open even when its snapshot arrives before the parent", () => {
    const workspaceDirectory = "/repo/worktree";
    const child = makeAgent({
      id: "child-agent",
      cwd: workspaceDirectory,
      parentAgentId: "parent-agent",
      status: "running",
    });
    const parent = makeAgent({
      id: "parent-agent",
      cwd: workspaceDirectory,
      status: "running",
    });

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: new Map<string, Agent>([
        [child.id, child],
        [parent.id, parent],
      ]),
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set(["child-agent", "parent-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["parent-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["child-agent", "parent-agent"]));
  });

  it("keeps archived agents out of activeAgentIds but present in knownAgentIds", () => {
    const workspaceDirectory = "/repo/worktree";
    const visible = makeAgent({
      id: "visible-agent",
      cwd: workspaceDirectory,
      createdAt: new Date("2026-03-04T00:00:00.000Z"),
      status: "running",
    });
    const archived = makeAgent({
      id: "archived-agent",
      cwd: workspaceDirectory,
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
      createdAt: new Date("2026-03-04T00:01:00.000Z"),
    });
    const otherWorkspace = makeAgent({
      id: "other-workspace-agent",
      cwd: "/repo/other",
    });

    const sessionAgents = new Map<string, Agent>([
      [visible.id, visible],
      [archived.id, archived],
      [otherWorkspace.id, otherWorkspace],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents,
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set(["visible-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["visible-agent"]));
    expect(result.knownAgentIds.has("visible-agent")).toBe(true);
    expect(result.knownAgentIds.has("archived-agent")).toBe(true);
    expect(result.knownAgentIds.has("other-workspace-agent")).toBe(false);
  });

  it("treats lazy historical details as known without making them active", () => {
    const workspaceDirectory = "/repo/worktree";
    const active = makeAgent({ id: "active-agent", cwd: workspaceDirectory });
    const historicalDetail = makeAgent({
      id: "historical-agent",
      cwd: workspaceDirectory,
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
    });

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents: new Map([[active.id, active]]),
      agentDetails: new Map([[historicalDetail.id, historicalDetail]]),
      workspaceDirectory,
    });

    expect(result.activeAgentIds).toEqual(new Set(["active-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["active-agent", "historical-agent"]));
  });

  it("prunes archived agent tabs so archiving on one client closes tabs on all clients", () => {
    const activeAgentIds = new Set<string>();

    expect(
      shouldPruneWorkspaceAgentTab({
        agentId: "archived-agent",
        agentsHydrated: true,
        activeAgentIds,
      }),
    ).toBe(true);
  });

  it("prunes pinned archived agent tabs because archive state is authoritative", () => {
    expect(
      shouldPruneWorkspaceAgentTab({
        agentId: "archived-agent",
        agentsHydrated: true,
        activeAgentIds: new Set<string>(),
      }),
    ).toBe(true);
  });

  it("does not prune active agent tabs", () => {
    const activeAgentIds = new Set(["active-agent"]);

    expect(
      shouldPruneWorkspaceAgentTab({
        agentId: "active-agent",
        agentsHydrated: true,
        activeAgentIds,
      }),
    ).toBe(false);
  });

  it("prunes agent tabs once agents are hydrated and the agent is missing from activeAgentIds", () => {
    expect(
      shouldPruneWorkspaceAgentTab({
        agentId: "missing-agent",
        agentsHydrated: true,
        activeAgentIds: new Set<string>(),
      }),
    ).toBe(true);
  });

  it("matches workspace agents when cwd and route workspace differ only by trailing slash", () => {
    const sessionAgents = new Map<string, Agent>([
      [
        "slash-agent",
        makeAgent({
          id: "slash-agent",
          cwd: "/Users/moboudra/dev/paseo/.dev/paseo-home/worktrees/1luy0po7/normal-squid/",
          status: "running",
        }),
      ],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents,
      workspaceDirectory:
        "/Users/moboudra/dev/paseo/.dev/paseo-home/worktrees/1luy0po7/normal-squid",
    });

    expect(result.activeAgentIds).toEqual(new Set(["slash-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["slash-agent"]));
    expect(result.knownAgentIds.has("slash-agent")).toBe(true);
  });

  it("matches workspace agents using the workspace directory even when the route uses a numeric workspace id", () => {
    const sessionAgents = new Map<string, Agent>([
      [
        "recent-agent",
        makeAgent({
          id: "recent-agent",
          cwd: "/tmp/workspace-lifecycle-main",
          status: "running",
        }),
      ],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      sessionAgents,
      workspaceDirectory: "/tmp/workspace-lifecycle-main",
    });

    expect(result.activeAgentIds).toEqual(new Set(["recent-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["recent-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["recent-agent"]));
  });

  it("builds the tab reconciliation snapshot without callers unpacking agent visibility", () => {
    const agentVisibility = {
      activeAgentIds: new Set(["active-agent"]),
      autoOpenAgentIds: new Set(["root-agent"]),
      knownAgentIds: new Set(["active-agent", "archived-agent"]),
      runningAgentIds: new Set(["root-agent"]),
    };

    expect(
      buildWorkspaceTabSnapshot({
        agentVisibility,
        agentsHydrated: true,
        terminalsHydrated: true,
        knownTerminalIds: ["terminal-1", "script-terminal"],
        standaloneTerminalIds: ["terminal-1"],
        hasActivePendingDraftCreate: false,
      }),
    ).toEqual({
      agentsHydrated: true,
      terminalsHydrated: true,
      activeAgentIds: agentVisibility.activeAgentIds,
      autoOpenAgentIds: agentVisibility.autoOpenAgentIds,
      knownAgentIds: agentVisibility.knownAgentIds,
      runningAgentIds: agentVisibility.runningAgentIds,
      knownTerminalIds: ["terminal-1", "script-terminal"],
      standaloneTerminalIds: ["terminal-1"],
      hasActivePendingDraftCreate: false,
    });
  });

  describe("workspaceAgentVisibilityEqual", () => {
    it("returns true for identical sets", () => {
      const a = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b", "c"]),
        runningAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b", "c"]),
        runningAgentIds: new Set(["a"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(true);
    });

    it("returns false when activeAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
        runningAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
        runningAgentIds: new Set(["a"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when autoOpenAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        runningAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["b"]),
        knownAgentIds: new Set(["a", "b"]),
        runningAgentIds: new Set(["a"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when knownAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
        runningAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        runningAgentIds: new Set(["a"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when runningAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        runningAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        runningAgentIds: new Set(["a", "b"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns true for empty sets", () => {
      const a = {
        activeAgentIds: new Set<string>(),
        autoOpenAgentIds: new Set<string>(),
        knownAgentIds: new Set<string>(),
        runningAgentIds: new Set<string>(),
      };
      const b = {
        activeAgentIds: new Set<string>(),
        autoOpenAgentIds: new Set<string>(),
        knownAgentIds: new Set<string>(),
        runningAgentIds: new Set<string>(),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(true);
    });
  });
});
