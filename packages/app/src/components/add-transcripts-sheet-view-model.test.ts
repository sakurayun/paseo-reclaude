import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  buildTranscriptSourceGroups,
  getGitRemoteIdentity,
  INITIAL_TRANSCRIPT_PICKER_STATE,
  reduceTranscriptPickerState,
  selectTranscriptCandidatesWithinLimit,
  selectTranscriptUnavailableHosts,
  settleWithConcurrency,
  type TranscriptSourceGroup,
} from "@/components/add-transcripts-sheet-view-model";

function agent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "host-a",
    serverLabel: "Host A",
    title: "Fix authentication",
    status: "idle",
    lastActivityAt: new Date("2026-07-18T10:00:00.000Z"),
    cwd: "/repos/paseo",
    workspaceId: "workspace-a",
    provider: "codex",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    labels: {},
    projectPlacement: {
      projectKey: "prj-a",
      projectName: "Paseo",
      workspaceName: "main",
      checkout: {
        cwd: "/repos/paseo",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "git@github.com:getpaseo/paseo.git",
        worktreeRoot: "/repos/paseo",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
    ...overrides,
  };
}

const destination = {
  serverId: "host-a",
  workspaceId: "workspace-a",
  projectKey: "prj-a",
  remoteUrl: "https://github.com/getpaseo/paseo.git",
};

function summarizeGroups(
  groups: readonly TranscriptSourceGroup[],
): Array<[TranscriptSourceGroup["kind"], string[]]> {
  const summary: Array<[TranscriptSourceGroup["kind"], string[]]> = [];
  for (const group of groups) {
    const agentIds: string[] = [];
    for (const entry of group.agents) {
      agentIds.push(entry.id);
    }
    summary.push([group.kind, agentIds]);
  }
  return summary;
}

describe("getGitRemoteIdentity", () => {
  it("matches SSH and HTTPS forms of the same remote", () => {
    expect(getGitRemoteIdentity("git@github.com:getpaseo/paseo.git")).toBe(
      getGitRemoteIdentity("https://github.com/getpaseo/paseo"),
    );
  });

  it("does not infer an identity from malformed remotes", () => {
    expect(getGitRemoteIdentity("paseo")).toBeNull();
  });

  it("keeps custom forge ports distinct", () => {
    expect(getGitRemoteIdentity("https://git.example:8443/org/repo")).not.toBe(
      getGitRemoteIdentity("https://git.example/org/repo"),
    );
  });
});

describe("buildTranscriptSourceGroups", () => {
  it("prioritizes the workspace, then the host-local project, then matching remotes", () => {
    const groups = buildTranscriptSourceGroups({
      destination,
      query: "",
      agents: [
        agent({ id: "workspace", workspaceId: "workspace-a" }),
        agent({ id: "project", workspaceId: "workspace-b" }),
        agent({
          id: "remote",
          serverId: "host-b",
          serverLabel: "Host B",
          workspaceId: "remote-workspace",
          projectPlacement: {
            ...agent().projectPlacement!,
            projectKey: "prj-b",
            workspaceName: "remote",
          },
        }),
        agent({
          id: "unrelated",
          serverId: "host-b",
          projectPlacement: {
            projectKey: "prj-unrelated",
            projectName: "Website",
            workspaceName: "main",
            checkout: {
              cwd: "/repos/website",
              isGit: true,
              currentBranch: "main",
              remoteUrl: "https://github.com/getpaseo/website.git",
              worktreeRoot: "/repos/website",
              isPaseoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ],
    });

    expect(summarizeGroups(groups)).toEqual([
      ["workspace", ["workspace"]],
      ["project", ["project"]],
      ["repository", ["remote"]],
    ]);
  });

  it("filters every group with the same search query", () => {
    const groups = buildTranscriptSourceGroups({
      destination,
      query: "host b",
      agents: [
        agent({ id: "workspace" }),
        agent({ id: "remote", serverId: "host-b", serverLabel: "Host B" }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("repository");
    expect(groups[0]?.agents.map((entry) => entry.id)).toEqual(["remote"]);
  });

  it("does not claim cross-host repository identity without a valid destination remote", () => {
    const groups = buildTranscriptSourceGroups({
      destination: { ...destination, remoteUrl: null },
      query: "",
      agents: [agent({ id: "remote", serverId: "host-b" })],
    });

    expect(groups).toEqual([]);
  });

  it("excludes archived agents until hosts retain their timelines durably", () => {
    const groups = buildTranscriptSourceGroups({
      destination,
      query: "",
      agents: [agent({ archivedAt: new Date("2026-07-18T11:00:00.000Z") })],
    });

    expect(groups).toEqual([]);
  });

  it("excludes managed subagents from the V1 top-level source list", () => {
    const groups = buildTranscriptSourceGroups({
      destination,
      query: "",
      agents: [
        agent({
          id: "child-agent",
          labels: { "paseo.parent-agent-id": "parent-agent" },
        }),
      ],
    });

    expect(groups).toEqual([]);
  });
});

describe("selectTranscriptUnavailableHosts", () => {
  it("does not warn about unrelated disconnected host records", () => {
    expect(
      selectTranscriptUnavailableHosts({
        destinationServerId: "host-a",
        hosts: [
          {
            serverId: "stale-host",
            serverLabel: "MacBook-Pro.local",
            reason: "disconnected",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps destination disconnections and queried-host history failures", () => {
    const destinationUnavailable = {
      serverId: "host-a",
      serverLabel: "This Mac",
      reason: "disconnected" as const,
    };
    const queriedHostFailure = {
      serverId: "host-b",
      serverLabel: "Build host",
      reason: "history_failed" as const,
    };

    expect(
      selectTranscriptUnavailableHosts({
        destinationServerId: "host-a",
        hosts: [
          destinationUnavailable,
          queriedHostFailure,
          {
            serverId: "offline-host",
            serverLabel: "Offline host",
            reason: "disconnected",
          },
        ],
      }),
    ).toEqual([destinationUnavailable, queriedHostFailure]);
  });
});

describe("reduceTranscriptPickerState", () => {
  it("keeps selection, errors, and loading transitions in one state owner", () => {
    const selected = reduceTranscriptPickerState(INITIAL_TRANSCRIPT_PICKER_STATE, {
      type: "toggle_source",
      key: "source-a",
      existingSourceKeys: new Set(),
      maximumError: "Too many",
    });
    const adding = reduceTranscriptPickerState(selected, { type: "start_add" });
    const failed = reduceTranscriptPickerState(adding, {
      type: "finish_add",
      errorsBySource: { "source-a": "Unavailable" },
      successfulKeys: new Set(),
    });

    expect(selected.selection).toEqual(["source-a"]);
    expect(adding).toMatchObject({ isAdding: true, errorsBySource: {} });
    expect(failed).toMatchObject({
      isAdding: false,
      selection: ["source-a"],
      errorsBySource: { "source-a": "Unavailable" },
    });
  });

  it("counts Fork-seeded chat history toward the five-transcript draft limit", () => {
    const existingSourceKeys = new Set(["fork-source"]);
    let state = INITIAL_TRANSCRIPT_PICKER_STATE;
    for (const key of ["source-1", "source-2", "source-3", "source-4", "source-5"]) {
      state = reduceTranscriptPickerState(state, {
        type: "toggle_source",
        key,
        existingSourceKeys,
        maximumError: "Too many",
      });
    }

    expect(state.selection).toEqual(["source-1", "source-2", "source-3", "source-4"]);
    expect(state.selectionError).toBe("Too many");
  });
});

describe("selectTranscriptCandidatesWithinLimit", () => {
  it("applies a shrinking refresh before a new source regardless of click order", () => {
    const result = selectTranscriptCandidatesWithinLimit({
      existingByteCountBySource: new Map([
        ["refresh", 300],
        ["other", 80],
      ]),
      candidates: [
        { key: "new", byteCount: 100 },
        { key: "refresh", byteCount: 100 },
      ],
      maxBytes: 400,
    });

    expect([...result.acceptedKeys]).toEqual(["refresh", "new"]);
    expect(result.rejectedKeys.size).toBe(0);
  });
});

describe("settleWithConcurrency", () => {
  it("preserves order while never exceeding the requested concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await settleWithConcurrency({
      values: [1, 2, 3, 4],
      limit: 2,
      task: async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "fulfilled", value: 6 },
      { status: "fulfilled", value: 8 },
    ]);
  });
});
