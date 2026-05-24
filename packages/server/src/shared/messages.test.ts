import { describe, expect, test } from "vitest";
import {
  CreateAgentRequestMessageSchema,
  FileExplorerRequestSchema,
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

function workspaceDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    projectId: "remote:github.com/acme/app",
    projectDisplayName: "acme/app",
    projectRootPath: "/repo/app",
    workspaceDirectory: "/repo/app",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "app",
    status: "done",
    activityAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  };
}

function fetchWorkspacesResponse(workspace: Record<string, unknown>) {
  return {
    type: "fetch_workspaces_response",
    payload: {
      requestId: "req-1",
      entries: [workspace],
      pageInfo: {
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
      },
    },
  };
}

describe("workspace descriptor message compatibility", () => {
  test("old-shaped fetch_workspaces_response without project still parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(workspaceDescriptor()),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toBeUndefined();
  });

  test("new-shaped fetch_workspaces_response with project placement parses", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          project: {
            projectKey: "remote:github.com/acme/app",
            projectName: "acme/app",
            checkout: {
              cwd: "/repo/app",
              isGit: true,
              currentBranch: "main",
              remoteUrl: "https://github.com/acme/app.git",
              worktreeRoot: "/repo/app",
              isPaseoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]?.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });

  test("adding project does not narrow existing descriptor fields", () => {
    const parsed = SessionOutboundMessageSchema.parse(
      fetchWorkspacesResponse(
        workspaceDescriptor({
          workspaceDirectory: undefined,
          projectKind: "non_git",
          workspaceKind: "directory",
          gitRuntime: null,
          githubRuntime: null,
          project: {
            projectKey: "/repo/local",
            projectName: "local",
            checkout: {
              cwd: "/repo/local",
              isGit: false,
              currentBranch: null,
              remoteUrl: null,
              worktreeRoot: null,
              isPaseoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          },
        }),
      ),
    );

    expect(parsed.type).toBe("fetch_workspaces_response");
    if (parsed.type !== "fetch_workspaces_response") {
      throw new Error("Expected fetch_workspaces_response");
    }
    expect(parsed.payload.entries[0]).toMatchObject({
      projectKind: "non_git",
      workspaceKind: "directory",
      workspaceDirectory: "/repo/app",
      gitRuntime: null,
      githubRuntime: null,
    });
  });
});

describe("model gateway message compatibility", () => {
  test("daemon config accepts model gateway registry entries", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: true },
      providers: {},
      modelGateways: {
        "9router-local": {
          type: "openai-compatible",
          label: "9Router local",
          baseUrl: "http://localhost:20128/v1",
        },
      },
    });

    expect(parsed.modelGateways["9router-local"]).toMatchObject({
      type: "openai-compatible",
      baseUrl: "http://localhost:20128/v1",
    });
  });

  test("daemon config patches accept model gateway updates", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        modelGateways: {
          "custom-gateway": {
            type: "openai-compatible",
            baseUrl: "https://gateway.example.com/v1",
            apiKey: "sk-test",
          },
        },
      }),
    ).toMatchObject({
      modelGateways: {
        "custom-gateway": {
          type: "openai-compatible",
          baseUrl: "https://gateway.example.com/v1",
        },
      },
    });
  });

  test("create agent requests accept per-session model gateway selection", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-1",
      config: {
        provider: "codex",
        cwd: "/workspace/project",
        model: "premium-coding",
        modelGateway: {
          type: "openai-compatible",
          label: "9Router remote",
          baseUrl: "https://router.example.com/v1",
          apiKey: "sk-router",
        },
      },
      workspaceId: "ws-1",
      clientMessageId: "client-1",
      attachments: [],
    });

    expect(parsed.config.modelGateway).toMatchObject({
      type: "openai-compatible",
      baseUrl: "https://router.example.com/v1",
    });
  });
});

describe("file explorer request compatibility", () => {
  test("acceptBinary is optional for old clients and accepted for new clients", () => {
    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-old",
      }),
    ).toEqual({
      type: "file_explorer_request",
      cwd: "/repo/app",
      path: "image.png",
      mode: "file",
      requestId: "req-old",
    });

    expect(
      FileExplorerRequestSchema.parse({
        type: "file_explorer_request",
        cwd: "/repo/app",
        path: "image.png",
        mode: "file",
        requestId: "req-new",
        acceptBinary: true,
      }),
    ).toMatchObject({
      type: "file_explorer_request",
      requestId: "req-new",
      acceptBinary: true,
    });
  });
});
