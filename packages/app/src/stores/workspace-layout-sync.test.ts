import { describe, expect, it, vi } from "vitest";

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  collectAllPanes,
  collectAllTabs,
  createDefaultLayout,
  findPaneById,
  mergeRemoteLayoutPreservingFocus,
  openTabInLayoutFocused,
  stripWorkspaceLayoutFocus,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import {
  pullWorkspaceLayoutIfNeeded,
  startWorkspaceLayoutSync,
} from "@/stores/workspace-layout-sync";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useSessionStore } from "@/stores/session-store";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

vi.mock("@/constants/layout", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/constants/layout")>();
  return {
    ...original,
    supportsDesktopPaneSplits: () => true,
  };
});

// Build a single-pane layout with the given agent tabs; the last one opened is focused
// (openTabInLayoutFocused focuses each newly opened tab).
function buildAgentLayout(agentIds: string[]): WorkspaceLayout {
  let layout = createDefaultLayout();
  for (const agentId of agentIds) {
    layout = openTabInLayoutFocused({
      layout,
      target: { kind: "agent", agentId },
      now: 1,
    }).layout;
  }
  return layout;
}

function tabIdsOf(layout: WorkspaceLayout): string[] {
  return collectAllTabs(layout.root).map((tab) => tab.tabId);
}

describe("stripWorkspaceLayoutFocus", () => {
  it("clears pane and layout focus but preserves tabs and order", () => {
    const layout = buildAgentLayout(["a1", "a2"]); // a2 focused
    const stripped = stripWorkspaceLayoutFocus(layout);

    expect(stripped.focusedPaneId).toBeNull();
    for (const pane of collectAllPanes(stripped.root)) {
      expect(pane.focusedTabId).toBeNull();
    }
    expect(tabIdsOf(stripped)).toEqual(["agent_a1", "agent_a2"]);
  });

  it("produces an identical stripped blob for two layouts that differ only in focus", () => {
    const focusedA1 = buildAgentLayout(["a2", "a1"]); // a1 focused
    const focusedA2 = buildAgentLayout(["a1", "a2"]); // a2 focused, same tab set
    // Reorder focusedA1 to match focusedA2's tab order so only focus differs.
    expect(JSON.stringify(stripWorkspaceLayoutFocus(focusedA2))).toEqual(
      JSON.stringify(stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2"]))),
    );
    // Sanity: focus genuinely differed before stripping.
    expect(findPaneById(focusedA1.root, "main")?.focusedTabId).toBe("agent_a1");
    expect(findPaneById(focusedA2.root, "main")?.focusedTabId).toBe("agent_a2");
  });
});

describe("mergeRemoteLayoutPreservingFocus", () => {
  it("adopts remote structure while keeping local focus when it still exists", () => {
    const local = buildAgentLayout(["a2", "a1"]); // local focuses a1
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2", "a3"]));

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    // Structure (tab set + order) comes from remote.
    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a2", "agent_a3"]);
    // Focus stays local: a1 is still present in the remote tree.
    expect(findPaneById(merged.root, "main")?.focusedTabId).toBe("agent_a1");
  });

  it("falls back to remote focus when the local focused tab is gone in remote", () => {
    const local = buildAgentLayout(["a9"]); // local focuses a9
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a2"]));

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a2"]);
    // a9 is gone in remote → normalizeLayout falls back to the last tab; never throws.
    expect(findPaneById(merged.root, "main")?.focusedTabId).toBe("agent_a2");
  });

  it("drops a tab the remote removed", () => {
    const local = buildAgentLayout(["a1", "a2", "a3"]);
    const remote = stripWorkspaceLayoutFocus(buildAgentLayout(["a1", "a3"])); // a2 closed elsewhere

    const merged = mergeRemoteLayoutPreservingFocus({ local, remote });

    expect(tabIdsOf(merged)).toEqual(["agent_a1", "agent_a3"]);
  });
});

describe("layout sync bridge — pending local opens", () => {
  it("re-opens a tab opened before the first pull on top of the pulled layout", async () => {
    const serverId = "srv-pending-open";
    const workspaceId = "ws-pending-open";
    await useWorkspaceLayoutStore.persist.rehydrate();
    useSessionStore.setState({
      sessions: {
        [serverId]: { serverInfo: { features: { workspaceLayoutSync: true } } },
      },
    } as never);

    let resolvePull: (envelope: unknown) => void = () => {};
    const pullPromise = new Promise((resolve) => {
      resolvePull = resolve;
    });
    const client = {
      getWorkspaceLayout: vi.fn(() => pullPromise),
      pushWorkspaceLayout: vi.fn(async () => ({ accepted: true, revision: 1 })),
      on: vi.fn(() => () => {}),
    } as unknown as DaemonClient;

    const stop = startWorkspaceLayoutSync({ serverId, client });
    const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    expect(key).toBeTruthy();

    // An SSH connect opens the terminal tab before the workspace has pulled.
    useWorkspaceLayoutStore
      .getState()
      .openTabFocused(key!, { kind: "terminal", terminalId: "term-ssh" });
    pullWorkspaceLayoutIfNeeded(serverId, workspaceId);

    // The daemon's blob predates the terminal tab: only a peer's agent tab.
    resolvePull({
      revision: 3,
      layout: stripWorkspaceLayoutFocus(buildAgentLayout(["peer-agent"])),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(key!);
    // Remote structure adopted...
    expect(tabs.some((tab) => tab.tabId === "agent_peer-agent")).toBe(true);
    // ...and the locally opened terminal tab survived the structure-wins merge.
    expect(
      tabs.some((tab) => tab.target.kind === "terminal" && tab.target.terminalId === "term-ssh"),
    ).toBe(true);

    stop();
    useWorkspaceLayoutStore.getState().purgeWorkspace(key!);
  });

  it("re-opens a post-pull SSH terminal tab wiped by a stale remote layout", async () => {
    const serverId = "srv-post-pull-ssh";
    const workspaceId = "ws-post-pull-ssh";
    await useWorkspaceLayoutStore.persist.rehydrate();
    useSessionStore.setState({
      sessions: {
        [serverId]: { serverInfo: { features: { workspaceLayoutSync: true } } },
      },
    } as never);

    type LayoutChangedHandler = (msg: {
      type: string;
      payload: {
        workspaceId: string;
        revision: number;
        layout: ReturnType<typeof stripWorkspaceLayoutFocus>;
      };
    }) => void;
    const layoutChangedHandlers: LayoutChangedHandler[] = [];
    const client = {
      getWorkspaceLayout: vi.fn(async () => ({
        revision: 1,
        layout: stripWorkspaceLayoutFocus(buildAgentLayout(["seed-agent"])),
      })),
      pushWorkspaceLayout: vi.fn(async () => ({ accepted: true, revision: 2 })),
      on: vi.fn((event: string, handler: LayoutChangedHandler) => {
        if (event === "workspace.layout.changed") {
          layoutChangedHandlers.push(handler);
        }
        return () => {};
      }),
    } as unknown as DaemonClient;

    const stop = startWorkspaceLayoutSync({ serverId, client });
    const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    expect(key).toBeTruthy();

    // First pull adopts the seed agent layout.
    pullWorkspaceLayoutIfNeeded(serverId, workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // User opens an SSH terminal after the workspace has already pulled.
    useWorkspaceLayoutStore
      .getState()
      .openTabFocused(key!, { kind: "terminal", terminalId: "term-ssh-late" });

    // A stale peer layout without the SSH tab arrives (e.g. before our push
    // lands, or from a race with switching sessions).
    expect(layoutChangedHandlers.length).toBeGreaterThan(0);
    for (const handler of layoutChangedHandlers) {
      handler({
        type: "workspace.layout.changed",
        payload: {
          workspaceId,
          revision: 5,
          layout: stripWorkspaceLayoutFocus(buildAgentLayout(["peer-only"])),
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(key!);
    expect(tabs.some((tab) => tab.tabId === "agent_peer-only")).toBe(true);
    expect(
      tabs.some(
        (tab) => tab.target.kind === "terminal" && tab.target.terminalId === "term-ssh-late",
      ),
    ).toBe(true);

    stop();
    useWorkspaceLayoutStore.getState().purgeWorkspace(key!);
  });
});
