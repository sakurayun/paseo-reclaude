import { describe, expect, it } from "vitest";
import type { DraftInput } from "@/stores/draft-store";
import type { WorkspaceTab } from "@/stores/workspace-tabs-store";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { navigateToPreparedWorkspaceTab, prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "/repo/worktree";
const AGENT_ID = "agent-1";

interface RecordedOpenedTab {
  key: string;
  target: WorkspaceTabTarget;
}

interface RecordedPin {
  key: string;
  agentId: string;
}

interface RecordedNavigation {
  serverId: string;
  workspaceId: string;
  currentPathname?: string | null;
}

function createFakeLayout(input?: {
  tabs?: WorkspaceTab[];
  draftInputs?: Record<string, DraftInput>;
  busyDraftIds?: ReadonlySet<string>;
}) {
  const openedTabs: RecordedOpenedTab[] = [];
  const pinnedAgents: RecordedPin[] = [];
  const tabs = input?.tabs ?? [];
  const draftInputs = input?.draftInputs ?? {};
  const busyDraftIds = input?.busyDraftIds ?? new Set<string>();
  return {
    openedTabs,
    pinnedAgents,
    openTabFocused: (key: string, target: WorkspaceTabTarget) => {
      openedTabs.push({ key, target });
      return target.kind === "agent" ? target.agentId : null;
    },
    pinAgent: (key: string, agentId: string) => {
      pinnedAgents.push({ key, agentId });
    },
    getWorkspaceTabs: (_key: string) => tabs,
    getDraftInput: (draftKey: string) => draftInputs[draftKey],
    isDraftBusy: ({ draftId }: { draftId: string }) => busyDraftIds.has(draftId),
    createDraftId: () => "draft-created",
  };
}

function createFakeNavigator() {
  const navigations: RecordedNavigation[] = [];
  return {
    navigations,
    navigateToWorkspace: (
      serverId: string,
      workspaceId: string,
      options: { currentPathname?: string | null },
    ) => {
      navigations.push({ serverId, workspaceId, currentPathname: options.currentPathname });
    },
  };
}

describe("prepareWorkspaceTab", () => {
  it("opens and focuses an agent tab", () => {
    const layout = createFakeLayout();

    const route = prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
      },
      layout,
    );

    expect(route).toBe("/h/server-1/workspace/b64_L3JlcG8vd29ya3RyZWU");
    expect(layout.openedTabs).toEqual([
      { key: "server-1:/repo/worktree", target: { kind: "agent", agentId: AGENT_ID } },
    ]);
    expect(layout.pinnedAgents).toEqual([]);
  });

  it("prepares a tab and navigates through the workspace navigation helper", () => {
    const layout = createFakeLayout();
    const navigator = createFakeNavigator();

    const route = navigateToPreparedWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
      },
      { ...layout, navigateToWorkspace: navigator.navigateToWorkspace },
    );

    expect(route).toBe("/h/server-1/workspace/b64_L3JlcG8vd29ya3RyZWU");
    expect(layout.openedTabs).toEqual([
      { key: "server-1:/repo/worktree", target: { kind: "agent", agentId: AGENT_ID } },
    ]);
    expect(navigator.navigations).toEqual([
      { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, currentPathname: undefined },
    ]);
  });

  it("focuses an existing empty draft tab for a new-agent request", () => {
    const layout = createFakeLayout({
      tabs: [
        {
          tabId: "draft-empty",
          target: { kind: "draft", draftId: "draft-empty" },
          createdAt: 1,
        },
      ],
    });

    prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "draft", draftId: "new" },
      },
      layout,
    );

    expect(layout.openedTabs).toEqual([
      {
        key: "server-1:/repo/worktree",
        target: { kind: "draft", draftId: "draft-empty" },
      },
    ]);
  });

  it("opens a new draft tab when the existing draft has input", () => {
    const layout = createFakeLayout({
      tabs: [
        {
          tabId: "draft-with-input",
          target: { kind: "draft", draftId: "draft-with-input" },
          createdAt: 1,
        },
      ],
      draftInputs: {
        "draft:server-1:draft-with-input": { text: "hello", attachments: [] },
      },
    });

    prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "draft", draftId: "new" },
      },
      layout,
    );

    expect(layout.openedTabs).toEqual([
      {
        key: "server-1:/repo/worktree",
        target: { kind: "draft", draftId: "draft-created" },
      },
    ]);
  });

  it("does not reuse setup or busy draft tabs", () => {
    const setup = {
      provider: "mock",
      cwd: "/repo/worktree",
      modeId: null,
      model: null,
      thinkingOptionId: null,
      featureValues: {},
    };
    const layout = createFakeLayout({
      tabs: [
        {
          tabId: "draft-setup",
          target: { kind: "draft", draftId: "draft-setup", setup },
          createdAt: 1,
        },
        {
          tabId: "draft-busy",
          target: { kind: "draft", draftId: "draft-busy" },
          createdAt: 2,
        },
      ],
      busyDraftIds: new Set(["draft-busy"]),
    });

    prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "draft", draftId: "new" },
      },
      layout,
    );

    expect(layout.openedTabs).toEqual([
      {
        key: "server-1:/repo/worktree",
        target: { kind: "draft", draftId: "draft-created" },
      },
    ]);
  });
});
