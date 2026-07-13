import { describe, expect, it, beforeEach } from "vitest";
import {
  findInFlightConnectIdByHost,
  useSshConnectStore,
  type SshConnectState,
} from "./ssh-connect-store";

function baseState(overrides: Partial<SshConnectState> = {}): SshConnectState {
  return {
    connectId: "c1",
    serverId: "srv",
    hostId: "host-1",
    workspaceId: "ws-1",
    cwd: null,
    label: "box",
    os: "ubuntu",
    status: "connecting",
    error: null,
    observedKey: null,
    usedPasswordOverride: false,
    log: [],
    ...overrides,
  };
}

describe("ssh-connect-store", () => {
  beforeEach(() => {
    useSshConnectStore.setState({ byId: {} });
  });

  it("starts, patches status, appends logs, and removes", () => {
    const store = useSshConnectStore.getState();
    store.start(baseState());
    expect(useSshConnectStore.getState().byId.c1?.status).toBe("connecting");

    store.appendLog("c1", { line: "Connecting…", level: "info" });
    store.patch("c1", { status: "auth_failed", error: "bad password" });
    const after = useSshConnectStore.getState().byId.c1;
    expect(after?.status).toBe("auth_failed");
    expect(after?.error).toBe("bad password");
    expect(after?.log).toEqual([{ line: "Connecting…", level: "info" }]);

    store.remove("c1");
    expect(useSshConnectStore.getState().byId.c1).toBeUndefined();
  });

  it("caps the log at 500 lines", () => {
    const store = useSshConnectStore.getState();
    store.start(baseState());
    for (let i = 0; i < 600; i++) {
      store.appendLog("c1", { line: `line ${i}`, level: "info" });
    }
    const log = useSshConnectStore.getState().byId.c1?.log ?? [];
    expect(log.length).toBe(500);
    expect(log[log.length - 1]?.line).toBe("line 599");
  });

  it("finds an in-flight connect for a host but ignores connected ones", () => {
    const store = useSshConnectStore.getState();
    store.start(baseState({ connectId: "c1", hostId: "host-1", status: "connecting" }));
    store.start(baseState({ connectId: "c2", hostId: "host-2", status: "connected" }));

    expect(findInFlightConnectIdByHost("srv", "host-1")).toBe("c1");
    expect(findInFlightConnectIdByHost("srv", "host-2")).toBeNull();
    expect(findInFlightConnectIdByHost("other-srv", "host-1")).toBeNull();
  });
});
