import { beforeEach, describe, expect, it, vi } from "vitest";

// The persist middleware hydrates through AsyncStorage, whose web build needs
// `window` (absent in the node test env) — back it with an in-memory map.
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

import { useSshTerminalMetaStore } from "./ssh-terminal-meta-store";

function reset(): void {
  useSshTerminalMetaStore.setState({ metaByTerminalId: {} });
}

describe("useSshTerminalMetaStore", () => {
  beforeEach(reset);

  it("registers and reads terminal meta", () => {
    useSshTerminalMetaStore.getState().register("t1", { hostId: "h1", label: "Box" });
    expect(useSshTerminalMetaStore.getState().metaByTerminalId.t1).toEqual({
      hostId: "h1",
      label: "Box",
    });
  });

  it("returns undefined for unknown terminals", () => {
    expect(useSshTerminalMetaStore.getState().metaByTerminalId.nope).toBeUndefined();
  });

  it("unregisters a terminal", () => {
    const store = useSshTerminalMetaStore.getState();
    store.register("t1", { hostId: "h1", label: "Box" });
    store.unregister("t1");
    expect(useSshTerminalMetaStore.getState().metaByTerminalId.t1).toBeUndefined();
  });

  it("keeps other entries when unregistering one", () => {
    const store = useSshTerminalMetaStore.getState();
    store.register("t1", { hostId: "h1", label: "A" });
    store.register("t2", { hostId: "h2", label: "B" });
    store.unregister("t1");
    const meta = useSshTerminalMetaStore.getState().metaByTerminalId;
    expect(meta.t1).toBeUndefined();
    expect(meta.t2).toEqual({ hostId: "h2", label: "B" });
  });

  it("returns the same state object when unregistering a missing terminal", () => {
    const store = useSshTerminalMetaStore.getState();
    store.register("t1", { hostId: "h1", label: "A" });
    const before = useSshTerminalMetaStore.getState().metaByTerminalId;
    store.unregister("missing");
    expect(useSshTerminalMetaStore.getState().metaByTerminalId).toBe(before);
  });
});
