import { describe, expect, it } from "vitest";
import type { ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import {
  assignTerminalsToSidebarGroups,
  groupSidebarSessionsByProject,
  resolveSidebarSessionGroupWorkspaceTarget,
} from "./sidebar-sessions-grouping";
import type { SidebarSessionEntry } from "./use-sidebar-sessions-list";

function placement(input: {
  projectKey?: string;
  projectName?: string;
  workspaceName?: string | null;
  isGit?: boolean;
  remoteUrl?: string | null;
}): ProjectPlacementPayload {
  const checkout: ProjectPlacementPayload["checkout"] =
    input.isGit === true
      ? {
          cwd: "/repo",
          isGit: true,
          currentBranch: "main",
          remoteUrl: input.remoteUrl ?? null,
          worktreeRoot: "/repo",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        }
      : {
          cwd: "/repo",
          isGit: false,
          currentBranch: null,
          remoteUrl: null,
          worktreeRoot: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        };

  return {
    projectKey: input.projectKey ?? "proj",
    projectName: input.projectName ?? "Project",
    workspaceName: input.workspaceName ?? null,
    checkout,
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

describe("groupSidebarSessionsByProject", () => {
  it("returns an empty list for no sessions", () => {
    expect(groupSidebarSessionsByProject([])).toEqual([]);
  });

  it("labels a GitHub project group as owner/repo even when workspace names differ", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "a",
        recencyMs: 10,
        projectPlacement: placement({
          projectKey: "remote:github.com/sakurayun/paseo-reclaude",
          projectName: "paseo-reclaude",
          workspaceName: "feature-x",
        }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].projectKey).toBe("remote:github.com/sakurayun/paseo-reclaude");
    expect(groups[0].label).toBe("sakurayun/paseo-reclaude");
    expect(groups[0].baseLabel).toBe("sakurayun/paseo-reclaude");
    expect(groups[0].iconKind).toBe("github");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("uses a project rename override while preserving the canonical repo label", () => {
    const groups = groupSidebarSessionsByProject(
      [
        session({
          id: "a",
          recencyMs: 10,
          projectPlacement: placement({
            projectKey: "remote:github.com/sakurayun/paseo-reclaude",
            projectName: "sakurayun/paseo-reclaude",
            workspaceName: "feature-x",
          }),
        }),
      ],
      new Map([["remote:github.com/sakurayun/paseo-reclaude", "Paseo 本地分支"]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Paseo 本地分支");
    expect(groups[0].baseLabel).toBe("sakurayun/paseo-reclaude");
    expect(groups[0].iconKind).toBe("github");
  });

  it("falls back to the local folder name when the project is not git-backed", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "a",
        recencyMs: 10,
        projectPlacement: placement({
          projectKey: "/Users/me/work/paseo-reclaude",
          projectName: "paseo-reclaude",
          workspaceName: null,
        }),
      }),
    ]);
    expect(groups[0].label).toBe("paseo-reclaude");
    expect(groups[0].iconKind).toBe("folder");
  });

  it("uses the git-folder icon for non-GitHub git projects", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "a",
        recencyMs: 10,
        projectPlacement: placement({
          projectKey: "remote:gitlab.com/acme/repo",
          projectName: "acme/repo",
          isGit: true,
          remoteUrl: "https://gitlab.com/acme/repo.git",
        }),
      }),
    ]);
    expect(groups[0].label).toBe("acme/repo");
    expect(groups[0].iconKind).toBe("git-folder");
  });

  it("does not expose a workspace id for project groups", () => {
    const groups = groupSidebarSessionsByProject([
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
        projectPlacement: placement({ workspaceName: "old name" }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].projectKey).toBe("proj");
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].key).toBe("project:proj");
    expect(groups[0].label).toBe("Project");
    expect(groups[0].baseLabel).toBe("Project");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("groups sessions by project key even when new conversations use different workspaces", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "a",
        recencyMs: 30,
        workspaceId: "ws-1",
        projectPlacement: placement({
          projectKey: "remote:github.com/sakurayun/paseo-reclaude",
          projectName: "paseo-reclaude",
          workspaceName: "main",
        }),
      }),
      session({
        id: "b",
        recencyMs: 20,
        workspaceId: "ws-2",
        projectPlacement: placement({
          projectKey: "remote:github.com/sakurayun/paseo-reclaude",
          projectName: "paseo-reclaude",
          workspaceName: "new-conversation-branch",
        }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("project:remote:github.com/sakurayun/paseo-reclaude");
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].label).toBe("sakurayun/paseo-reclaude");
    expect(groups[0].baseLabel).toBe("sakurayun/paseo-reclaude");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("groups workspace-less history sessions by project key", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "newer",
        recencyMs: 30,
        projectPlacement: placement({ projectKey: "p", workspaceName: "main" }),
      }),
      session({
        id: "older",
        recencyMs: 10,
        projectPlacement: placement({ projectKey: "p", workspaceName: "feature" }),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("does not split two workspaces under the same project", () => {
    const groups = groupSidebarSessionsByProject([
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
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Project");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("does not merge same-named workspaces from different projects", () => {
    const groups = groupSidebarSessionsByProject([
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
    const groups = groupSidebarSessionsByProject([
      session({ id: "a", recencyMs: 50, projectPlacement: placement({ projectKey: "p1" }) }),
      session({ id: "b", recencyMs: 40, projectPlacement: placement({ projectKey: "p2" }) }),
      session({ id: "c", recencyMs: 30, projectPlacement: placement({ projectKey: "p1" }) }),
    ]);
    expect(groups.map((g) => g.key === "project:p1")).toEqual([true, false]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps an empty label when no placement is available for the header to localize", () => {
    const groups = groupSidebarSessionsByProject([
      session({ id: "a", recencyMs: 10, projectPlacement: null, projectName: null }),
    ]);
    expect(groups[0].label).toBe("");
    expect(groups[0].workspaceId).toBeNull();
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("resolveSidebarSessionGroupWorkspaceTarget", () => {
  it("opens the newest session workspace in a project group", () => {
    const [group] = groupSidebarSessionsByProject([
      session({
        id: "newer",
        recencyMs: 30,
        workspaceId: "ws-newer",
        projectPlacement: placement({ projectKey: "p" }),
      }),
      session({
        id: "older",
        recencyMs: 10,
        workspaceId: "ws-older",
        projectPlacement: placement({ projectKey: "p" }),
      }),
    ]);

    expect(resolveSidebarSessionGroupWorkspaceTarget(group, "server")).toEqual({
      serverId: "server",
      workspaceId: "ws-newer",
    });
  });

  it("skips workspace-less history entries instead of routing to the new workspace screen", () => {
    const [group] = groupSidebarSessionsByProject([
      session({
        id: "history",
        recencyMs: 30,
        projectPlacement: placement({ projectKey: "p" }),
      }),
      session({
        id: "known-workspace",
        recencyMs: 10,
        workspaceId: "ws-known",
        projectPlacement: placement({ projectKey: "p" }),
      }),
    ]);

    expect(resolveSidebarSessionGroupWorkspaceTarget(group, "server")).toEqual({
      serverId: "server",
      workspaceId: "ws-known",
    });
  });

  it("returns null when no workspace can host the new-agent tab", () => {
    const [group] = groupSidebarSessionsByProject([
      session({
        id: "history",
        recencyMs: 30,
        projectPlacement: placement({ projectKey: "p" }),
      }),
    ]);

    expect(resolveSidebarSessionGroupWorkspaceTarget(group, "server")).toBeNull();
    expect(resolveSidebarSessionGroupWorkspaceTarget(group, " ")).toBeNull();
  });
});

describe("assignTerminalsToSidebarGroups", () => {
  it("matches by workspaceId first, then by cwd ancestry, and drops orphans", () => {
    const groups = groupSidebarSessionsByProject([
      session({
        id: "s1",
        recencyMs: 2,
        workspaceId: "ws-a",
        projectPlacement: placement({ projectKey: "proj-a" }),
      }),
      session({
        id: "s2",
        recencyMs: 1,
        workspaceId: "ws-b",
        projectPlacement: placement({ projectKey: "proj-b" }),
      }),
    ]);
    const groupA = groups.find((group) => group.projectKey === "proj-a");
    const groupB = groups.find((group) => group.projectKey === "proj-b");

    const byWorkspace = { id: "t1", cwd: "/elsewhere", workspaceId: "ws-b" };
    // session() fixtures all use cwd "/repo": a terminal in a subdirectory of
    // that cwd resolves through ancestry to the first matching group.
    const byCwd = { id: "t2", cwd: "/repo/sub", workspaceId: "standalone:/repo/sub" };
    const orphan = { id: "t3", cwd: "/nowhere", workspaceId: "standalone:/nowhere" };

    const assigned = assignTerminalsToSidebarGroups(groups, [byWorkspace, byCwd, orphan]);

    expect(assigned.get(groupB?.key ?? "")).toEqual([byWorkspace]);
    expect(assigned.get(groupA?.key ?? "")).toEqual([byCwd]);
    expect([...assigned.values()].flat()).toHaveLength(2);
  });
});
