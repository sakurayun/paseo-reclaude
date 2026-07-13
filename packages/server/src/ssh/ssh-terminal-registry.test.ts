import { describe, expect, it } from "vitest";

import { createSshTerminalRegistry } from "./ssh-terminal-registry.js";

describe("ssh terminal registry", () => {
  it("registers and resolves terminal metadata", () => {
    const registry = createSshTerminalRegistry();
    registry.register("term-1", {
      hostId: "host-1",
      hostLabel: "Prod Box",
      via: "ssh2",
      connectedAt: 100,
    });

    expect(registry.get("term-1")).toEqual({
      hostId: "host-1",
      hostLabel: "Prod Box",
      via: "ssh2",
      connectedAt: 100,
    });
    expect(registry.get("term-unknown")).toBeUndefined();
  });

  it("lists terminal ids scoped to a host", () => {
    const registry = createSshTerminalRegistry();
    registry.register("term-1", {
      hostId: "host-1",
      hostLabel: "Prod Box",
      via: "ssh2",
      connectedAt: 1,
    });
    registry.register("term-2", {
      hostId: "host-1",
      hostLabel: "Prod Box",
      via: "fallback",
      connectedAt: 2,
    });
    registry.register("term-3", {
      hostId: "host-2",
      hostLabel: "Staging",
      via: "ssh2",
      connectedAt: 3,
    });

    expect(registry.listTerminalIdsByHost("host-1")).toEqual(["term-1", "term-2"]);
    expect(registry.listTerminalIdsByHost("host-2")).toEqual(["term-3"]);
    expect(registry.listTerminalIdsByHost("host-3")).toEqual([]);
  });

  it("drops entries on unregister", () => {
    const registry = createSshTerminalRegistry();
    registry.register("term-1", {
      hostId: "host-1",
      hostLabel: "Prod Box",
      via: "ssh2",
      connectedAt: 1,
    });

    registry.unregister("term-1");

    expect(registry.get("term-1")).toBeUndefined();
    expect(registry.listTerminalIdsByHost("host-1")).toEqual([]);
  });
});
