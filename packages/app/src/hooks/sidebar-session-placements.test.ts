import { describe, expect, it } from "vitest";
import type { ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import { applySidebarSessionPlacements } from "./sidebar-session-placements";
import type { SidebarSessionEntry } from "./use-sidebar-sessions-list";

function authoritativePlacement(projectKey: string): ProjectPlacementPayload {
  return {
    projectKey,
    projectName: "Repo",
    workspaceName: null,
    checkout: {
      cwd: "/repo",
      isGit: true,
      currentBranch: "main",
      remoteUrl: "git@github.com:sakurayun/paseo-reclaude.git",
      worktreeRoot: "/repo",
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    },
  };
}

function session(input: {
  id: string;
  cwd: string;
  projectPlacement?: ProjectPlacementPayload | null;
}): SidebarSessionEntry {
  return {
    id: input.id,
    serverId: "server",
    title: input.id,
    status: "idle",
    lastActivityAt: new Date(0),
    cwd: input.cwd,
    workspaceId: undefined,
    provider: "claude",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date(0),
    labels: {},
    projectPlacement: input.projectPlacement,
    recencyAt: new Date(0),
    projectName: input.projectPlacement?.projectName ?? null,
  } as SidebarSessionEntry;
}

describe("applySidebarSessionPlacements", () => {
  it("inherits an authoritative sibling's placement for a placement-less new session", () => {
    const existing = session({
      id: "existing",
      cwd: "/repo",
      projectPlacement: authoritativePlacement("remote:github.com/sakurayun/paseo-reclaude"),
    });
    // A brand-new conversation enters without a placement (the daemon has not
    // reported its project yet).
    const fresh = session({ id: "fresh", cwd: "/repo", projectPlacement: null });

    const [, resolvedFresh] = applySidebarSessionPlacements([existing, fresh]);

    expect(resolvedFresh.projectPlacement?.projectKey).toBe(
      "remote:github.com/sakurayun/paseo-reclaude",
    );
    expect(resolvedFresh.projectName).toBe("Repo");
  });

  it("falls back to a cwd-derived placement when no authoritative sibling exists", () => {
    const fresh = session({ id: "fresh", cwd: "/repo", projectPlacement: null });

    const [resolved] = applySidebarSessionPlacements([fresh]);

    // Never null — grouping must never land it under the empty "Other" group.
    expect(resolved.projectPlacement).not.toBeNull();
    expect(resolved.projectPlacement?.projectKey).toBe("/repo");
  });

  it("leaves a session that already has an authoritative placement untouched", () => {
    const entry = session({
      id: "entry",
      cwd: "/repo",
      projectPlacement: authoritativePlacement("remote:github.com/sakurayun/paseo-reclaude"),
    });

    const [resolved] = applySidebarSessionPlacements([entry]);

    expect(resolved).toBe(entry);
  });

  it("does not inherit across different working directories", () => {
    const existing = session({
      id: "existing",
      cwd: "/repo-a",
      projectPlacement: authoritativePlacement("remote:github.com/owner/repo-a"),
    });
    const fresh = session({ id: "fresh", cwd: "/repo-b", projectPlacement: null });

    const [, resolvedFresh] = applySidebarSessionPlacements([existing, fresh]);

    expect(resolvedFresh.projectPlacement?.projectKey).toBe("/repo-b");
  });
});
