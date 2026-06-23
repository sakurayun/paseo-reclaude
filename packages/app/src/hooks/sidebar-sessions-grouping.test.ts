import { describe, expect, it } from "vitest";
import type { ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import { groupSidebarSessionsByWorkspace } from "./sidebar-sessions-grouping";
import type { SidebarSessionEntry } from "./use-sidebar-sessions-list";

function placement(input: {
  projectKey?: string;
  projectName?: string;
  workspaceName?: string | null;
}): ProjectPlacementPayload {
  return {
    projectKey: input.projectKey ?? "proj",
    projectName: input.projectName ?? "Project",
    workspaceName: input.workspaceName ?? null,
    checkout: {
      cwd: "/repo",
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    },
  };
}

function session(input: {
  id: string;
  recencyMs: number;
  workspaceId?: string | null;
  projectPlacement?: ProjectPlacementPayload | null;
  projectName?: string | null;
}): SidebarSessionEntry {
  return {
    id: input.id,
    serverId: "server",
    title: input.id,
    status: "idle",
    lastActivityAt: new Date(input.recencyMs),
    cwd: "/repo",
    workspaceId: input.workspaceId ?? undefined,
    provider: "claude",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date(0),
    labels: {},
    projectPlacement: input.projectPlacement,
    recencyAt: new Date(input.recencyMs),
    projectName:
      input.projectName !== undefined
        ? input.projectName
        : (input.projectPlacement?.projectName ?? null),
  } as SidebarSessionEntry;
}

describe("groupSidebarSessionsByWorkspace", () => {
  it("returns an empty list for no sessions", () => {
    expect(groupSidebarSessionsByWorkspace([])).toEqual([]);
  });

  it("labels a group by the workspace name when present", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "a",
        recencyMs: 10,
        projectPlacement: placement({ workspaceName: "feature-x" }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("feature-x");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("falls back to the project name when the workspace name is absent", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "a",
        recencyMs: 10,
        projectPlacement: placement({ projectName: "Paseo", workspaceName: null }),
      }),
    ]);
    expect(groups[0].label).toBe("Paseo");
  });

  it("groups sessions by workspace id and exposes it for renaming", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "newer",
        recencyMs: 30,
        workspaceId: "ws-1",
        projectPlacement: placement({ workspaceName: "main" }),
      }),
      session({
        id: "older",
        recencyMs: 10,
        workspaceId: "ws-1",
        // A staler placement label must not split the group — id wins.
        projectPlacement: placement({ workspaceName: "old name" }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].workspaceId).toBe("ws-1");
    expect(groups[0].key).toBe("ws:ws-1");
    expect(groups[0].label).toBe("main");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("splits sessions with different workspace ids even under the same name", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "a",
        recencyMs: 30,
        workspaceId: "ws-1",
        projectPlacement: placement({ workspaceName: "main" }),
      }),
      session({
        id: "b",
        recencyMs: 20,
        workspaceId: "ws-2",
        projectPlacement: placement({ workspaceName: "main" }),
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.workspaceId)).toEqual(["ws-1", "ws-2"]);
  });

  it("groups workspace-less history sessions by (projectKey, workspaceName)", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "newer",
        recencyMs: 30,
        projectPlacement: placement({ projectKey: "p", workspaceName: "main" }),
      }),
      session({
        id: "older",
        recencyMs: 10,
        projectPlacement: placement({ projectKey: "p", workspaceName: "main" }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("separates two workspaces under the same project", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "a",
        recencyMs: 30,
        projectPlacement: placement({ projectKey: "p", workspaceName: "feature" }),
      }),
      session({
        id: "b",
        recencyMs: 20,
        projectPlacement: placement({ projectKey: "p", workspaceName: "main" }),
      }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["feature", "main"]);
  });

  it("does not merge same-named workspaces from different projects", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({
        id: "a",
        recencyMs: 30,
        projectPlacement: placement({
          projectKey: "p1",
          projectName: "One",
          workspaceName: "main",
        }),
      }),
      session({
        id: "b",
        recencyMs: 20,
        projectPlacement: placement({
          projectKey: "p2",
          projectName: "Two",
          workspaceName: "main",
        }),
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.sessions[0].id)).toEqual(["a", "b"]);
  });

  it("orders groups by first appearance (most-recent session leads)", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({ id: "a", recencyMs: 50, projectPlacement: placement({ projectKey: "p1" }) }),
      session({ id: "b", recencyMs: 40, projectPlacement: placement({ projectKey: "p2" }) }),
      session({ id: "c", recencyMs: 30, projectPlacement: placement({ projectKey: "p1" }) }),
    ]);
    expect(groups.map((g) => g.key.startsWith("pp:p1"))).toEqual([true, false]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps an empty label when no placement is available for the header to localize", () => {
    const groups = groupSidebarSessionsByWorkspace([
      session({ id: "a", recencyMs: 10, projectPlacement: null, projectName: null }),
    ]);
    expect(groups[0].label).toBe("");
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a"]);
  });
});
