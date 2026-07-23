import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  closeSshTerminalAcrossServerWorkspaces,
  collectLiveSshTerminalIds,
  openSshTerminalAcrossServerWorkspaces,
  pruneStaleSshTerminalMeta,
} from "@/screens/ssh/ssh-workspace-tabs";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useSshTerminalMetaStore } from "@/stores/ssh-terminal-meta-store";

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

describe("collectLiveSshTerminalIds", () => {
  it("returns meta-registered live SSH terminals for the server", () => {
    expect(
      collectLiveSshTerminalIds({
        serverId: "srv-1",
        metaByTerminalId: {
          "term-a": { hostId: "h1", label: "A", serverId: "srv-1" },
          "term-b": { hostId: "h2", label: "B", serverId: "srv-2" },
          "term-legacy": { hostId: "h3", label: "Legacy" },
        },
        hostWideTerminals: [
          { id: "term-a", status: "running" },
          { id: "term-legacy", status: "running" },
        ],
      }).sort(),
    ).toEqual(["term-a", "term-legacy"]);
  });

  it("excludes exited SSH terminals", () => {
    expect(
      collectLiveSshTerminalIds({
        serverId: "srv-1",
        metaByTerminalId: {
          "term-dead": { hostId: "h1", label: "Dead", serverId: "srv-1" },
          "term-live": { hostId: "h2", label: "Live", serverId: "srv-1" },
        },
        hostWideTerminals: [
          { id: "term-dead", status: "exited" },
          { id: "term-live", status: "running" },
        ],
      }),
    ).toEqual(["term-live"]);
  });

  it("does not resurrect meta-only terminals missing from the host-wide list", () => {
    // Regression: after "close for good", meta used to survive restart and
    // auto-open would bring the dead shell back even though the host no longer
    // lists it.
    expect(
      collectLiveSshTerminalIds({
        serverId: "srv-1",
        metaByTerminalId: {
          "term-killed": { hostId: "h1", label: "Killed", serverId: "srv-1" },
        },
        hostWideTerminals: [],
      }),
    ).toEqual([]);
  });
});

describe("pruneStaleSshTerminalMeta", () => {
  beforeEach(() => {
    useSshTerminalMetaStore.setState({ metaByTerminalId: {} });
  });

  it("unregisters meta only for exited host terminals", () => {
    useSshTerminalMetaStore.getState().register("term-dead", {
      hostId: "h1",
      label: "Dead",
      serverId: "srv-1",
    });
    useSshTerminalMetaStore.getState().register("term-gone", {
      hostId: "h1",
      label: "Gone",
      serverId: "srv-1",
    });
    useSshTerminalMetaStore.getState().register("term-live", {
      hostId: "h1",
      label: "Live",
      serverId: "srv-1",
    });

    pruneStaleSshTerminalMeta({
      serverId: "srv-1",
      metaByTerminalId: useSshTerminalMetaStore.getState().metaByTerminalId,
      hostWideTerminals: [
        { id: "term-dead", status: "exited" },
        { id: "term-live", status: "running" },
      ],
    });

    const meta = useSshTerminalMetaStore.getState().metaByTerminalId;
    expect(meta["term-dead"]).toBeUndefined();
    // Missing from the list is NOT pruned — empty/partial host-wide snapshots
    // must not wipe badges for shells still open in the layout.
    expect(meta["term-gone"]).toEqual({
      hostId: "h1",
      label: "Gone",
      serverId: "srv-1",
    });
    expect(meta["term-live"]).toEqual({
      hostId: "h1",
      label: "Live",
      serverId: "srv-1",
    });
  });

  it("does nothing when the host-wide list is empty", () => {
    useSshTerminalMetaStore.getState().register("term-live", {
      hostId: "h1",
      label: "Live",
      serverId: "srv-1",
      os: "ubuntu",
    });
    pruneStaleSshTerminalMeta({
      serverId: "srv-1",
      metaByTerminalId: useSshTerminalMetaStore.getState().metaByTerminalId,
      hostWideTerminals: [],
    });
    expect(useSshTerminalMetaStore.getState().metaByTerminalId["term-live"]?.os).toBe("ubuntu");
  });
});

describe("openSshTerminalAcrossServerWorkspaces", () => {
  beforeEach(async () => {
    await useWorkspaceLayoutStore.persist.rehydrate();
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
    useSessionStore.setState({
      sessions: {
        "srv-1": {
          workspaces: new Map([
            ["ws-a", { workspaceId: "ws-a" }],
            ["ws-b", { workspaceId: "ws-b" }],
            ["ws-c", { workspaceId: "ws-c" }],
          ]),
        },
      },
    } as never);
  });

  it("opens the SSH terminal tab in every workspace, focusing the target one", () => {
    openSshTerminalAcrossServerWorkspaces({
      serverId: "srv-1",
      terminalId: "term-ssh",
      focusWorkspaceId: "ws-b",
    });

    const store = useWorkspaceLayoutStore.getState();
    for (const workspaceId of ["ws-a", "ws-b", "ws-c"]) {
      const key = buildWorkspaceTabPersistenceKey({ serverId: "srv-1", workspaceId });
      const tabs = store.getWorkspaceTabs(key!);
      expect(
        tabs.some((tab) => tab.target.kind === "terminal" && tab.target.terminalId === "term-ssh"),
      ).toBe(true);
    }

    const focusKey = buildWorkspaceTabPersistenceKey({ serverId: "srv-1", workspaceId: "ws-b" });
    const layout = store.layoutByWorkspace[focusKey!];
    expect(layout).toBeTruthy();
  });

  it("closes the SSH terminal tab in every workspace and drops meta", () => {
    useSshTerminalMetaStore.setState({
      metaByTerminalId: {
        "term-ssh": { hostId: "h1", label: "Box", serverId: "srv-1" },
      },
    });
    openSshTerminalAcrossServerWorkspaces({
      serverId: "srv-1",
      terminalId: "term-ssh",
      focusWorkspaceId: "ws-a",
    });

    closeSshTerminalAcrossServerWorkspaces({
      serverId: "srv-1",
      terminalId: "term-ssh",
    });

    const store = useWorkspaceLayoutStore.getState();
    for (const workspaceId of ["ws-a", "ws-b", "ws-c"]) {
      const key = buildWorkspaceTabPersistenceKey({ serverId: "srv-1", workspaceId });
      const tabs = store.getWorkspaceTabs(key!);
      expect(
        tabs.some((tab) => tab.target.kind === "terminal" && tab.target.terminalId === "term-ssh"),
      ).toBe(false);
    }
    expect(useSshTerminalMetaStore.getState().metaByTerminalId["term-ssh"]).toBeUndefined();
  });
});
