import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { buildWorkspaceSessionSections } from "./sessions-panel-model";

function makeWorkspace(input: {
  id: string;
  projectId?: string;
  projectRootPath?: string;
  workspaceDirectory?: string;
  workspaceKind?: WorkspaceDescriptor["workspaceKind"];
  name?: string;
  branch?: string | null;
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: "Project",
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? input.id,
    projectKind: "git" as WorkspaceDescriptor["projectKind"],
    workspaceKind: input.workspaceKind ?? "checkout",
    name: input.name ?? input.id,
    status: "idle" as WorkspaceDescriptor["status"],
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime:
      input.branch === undefined
        ? undefined
        : ({ currentBranch: input.branch } as WorkspaceDescriptor["gitRuntime"]),
  };
}

function makeAgent(input: {
  id: string;
  cwd: string;
  archivedAt?: string | null;
  lastActivityAt?: Date;
}): AgentDirectoryEntry {
  return {
    id: input.id,
    serverId: "server-a",
    title: input.id,
    status: "idle",
    lastActivityAt: input.lastActivityAt ?? new Date("2026-06-01T00:00:00Z"),
    cwd: input.cwd,
    provider: "claude",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: input.archivedAt ?? null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    labels: [],
  } as unknown as AgentDirectoryEntry;
}

const ROOT = makeWorkspace({
  id: "/repo",
  workspaceDirectory: "/repo",
  workspaceKind: "checkout",
  name: "repo",
  branch: "main",
});
const WORKTREE = makeWorkspace({
  id: "/repo/.dev/worktrees/feature-x",
  workspaceDirectory: "/repo/.dev/worktrees/feature-x",
  workspaceKind: "worktree",
  name: "feature-x",
  branch: "feature-x",
});

describe("buildWorkspaceSessionSections", () => {
  it("groups sessions under the most specific workspace directory", () => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: "/repo",
      workspaces: [ROOT, WORKTREE],
      agents: [
        makeAgent({ id: "root-agent", cwd: "/repo" }),
        makeAgent({ id: "worktree-agent", cwd: "/repo/.dev/worktrees/feature-x" }),
      ],
      includeArchived: false,
      otherSectionTitle: "Other",
    });

    expect(sections.map((section) => section.workspaceId)).toEqual([
      "/repo",
      "/repo/.dev/worktrees/feature-x",
    ]);
    expect(sections[0].sessions.map((agent) => agent.id)).toEqual(["root-agent"]);
    expect(sections[0].branch).toBe("main");
    expect(sections[0].isCurrent).toBe(true);
    expect(sections[1].sessions.map((agent) => agent.id)).toEqual(["worktree-agent"]);
  });

  it("filters archived sessions by default and includes them on demand", () => {
    const agents = [
      makeAgent({ id: "live", cwd: "/repo" }),
      makeAgent({ id: "archived", cwd: "/repo", archivedAt: "2026-06-01T00:00:00Z" }),
    ];

    const hidden = buildWorkspaceSessionSections({
      currentWorkspaceId: "/repo",
      workspaces: [ROOT],
      agents,
      includeArchived: false,
      otherSectionTitle: "Other",
    });
    expect(hidden[0].sessions.map((agent) => agent.id)).toEqual(["live"]);

    const shown = buildWorkspaceSessionSections({
      currentWorkspaceId: "/repo",
      workspaces: [ROOT],
      agents,
      includeArchived: true,
      otherSectionTitle: "Other",
    });
    expect(shown[0].sessions.map((agent) => agent.id)).toEqual(["live", "archived"]);
  });

  it("puts sessions under the project root with no live workspace into the catch-all", () => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: "/repo",
      workspaces: [ROOT, WORKTREE],
      agents: [makeAgent({ id: "orphan", cwd: "/repo/.dev/worktrees/removed-branch" })],
      includeArchived: false,
      otherSectionTitle: "Other",
    });

    const otherSection = sections.find((section) => section.workspaceId === null);
    // /repo/.dev/... is under the root workspace directory, so it attributes to
    // the root rather than the catch-all. Sessions truly outside every
    // workspace but inside projectRootPath only exist when the root checkout
    // itself is not a workspace; simulate that with a worktree-only project.
    expect(otherSection).toBeUndefined();

    const worktreeOnly = buildWorkspaceSessionSections({
      currentWorkspaceId: WORKTREE.id,
      workspaces: [WORKTREE],
      agents: [makeAgent({ id: "orphan", cwd: "/repo/old-worktree" })],
      includeArchived: false,
      otherSectionTitle: "Other",
    });
    const catchAll = worktreeOnly.find((section) => section.workspaceId === null);
    expect(catchAll?.sessions.map((agent) => agent.id)).toEqual(["orphan"]);
  });

  it("orders sections current-first, then root, then worktrees; sessions by recency", () => {
    const sections = buildWorkspaceSessionSections({
      currentWorkspaceId: WORKTREE.id,
      workspaces: [ROOT, WORKTREE],
      agents: [
        makeAgent({
          id: "older",
          cwd: WORKTREE.id,
          lastActivityAt: new Date("2026-06-01T00:00:00Z"),
        }),
        makeAgent({
          id: "newer",
          cwd: WORKTREE.id,
          lastActivityAt: new Date("2026-06-02T00:00:00Z"),
        }),
      ],
      includeArchived: false,
      otherSectionTitle: "Other",
    });

    expect(sections[0].workspaceId).toBe(WORKTREE.id);
    expect(sections[0].isCurrent).toBe(true);
    expect(sections[1].workspaceId).toBe(ROOT.id);
    expect(sections[0].sessions.map((agent) => agent.id)).toEqual(["newer", "older"]);
  });
});
