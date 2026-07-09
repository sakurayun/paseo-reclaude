import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSshLogStore } from "./ssh-log-store.js";

function tempStorePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "ssh-logs-")), "ssh-logs.json");
}

describe("createSshLogStore", () => {
  const stores: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.dispose();
    }
  });

  it("tracks a connection through begin → connected → closed with duration", () => {
    const store = createSshLogStore({ storePath: tempStorePath() });
    stores.push(store);

    const id = store.begin({
      hostId: "h1",
      hostLabel: "Box",
      username: "root",
      address: "10.0.0.1",
      port: 22,
      protocol: "ssh",
    });
    store.markConnected(id);
    expect(store.list()[0]?.status).toBe("connected");

    store.complete(id, { status: "closed" });
    const entry = store.list()[0];
    expect(entry?.status).toBe("closed");
    expect(entry?.endedAt).not.toBeNull();
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failure with its error message", () => {
    const store = createSshLogStore({ storePath: tempStorePath() });
    stores.push(store);

    const id = store.begin({
      hostId: "h1",
      hostLabel: "Box",
      address: "10.0.0.1",
      protocol: "ssh",
    });
    store.complete(id, { status: "failed", error: "Authentication failed" });
    expect(store.list()[0]).toMatchObject({ status: "failed", error: "Authentication failed" });
  });

  it("returns newest entries first and honors the list limit", () => {
    const store = createSshLogStore({ storePath: tempStorePath() });
    stores.push(store);

    for (let i = 0; i < 5; i += 1) {
      store.begin({ hostId: `h${i}`, hostLabel: `Box ${i}`, address: "10.0.0.1", protocol: "ssh" });
    }
    const limited = store.list(2);
    expect(limited).toHaveLength(2);
    expect(limited[0]?.hostId).toBe("h4");
  });

  it("caps the ring buffer at 500 entries", () => {
    const store = createSshLogStore({ storePath: tempStorePath() });
    stores.push(store);

    for (let i = 0; i < 520; i += 1) {
      store.begin({ hostId: `h${i}`, hostLabel: "Box", address: "10.0.0.1", protocol: "ssh" });
    }
    const entries = store.list();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.hostId).toBe("h519");
  });

  it("notifies subscribers on begin and complete", () => {
    const store = createSshLogStore({ storePath: tempStorePath() });
    stores.push(store);

    const seen: string[] = [];
    const unsubscribe = store.subscribeUpdated((entry) => {
      seen.push(entry.status);
    });
    const id = store.begin({
      hostId: "h1",
      hostLabel: "Box",
      address: "10.0.0.1",
      protocol: "ssh",
    });
    store.complete(id, { status: "closed" });
    unsubscribe();
    store.begin({ hostId: "h2", hostLabel: "Box2", address: "10.0.0.2", protocol: "ssh" });

    expect(seen).toEqual(["failed", "closed"]); // begin's pessimistic default, then closed
  });
});
