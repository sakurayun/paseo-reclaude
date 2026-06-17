import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPortForwardManager, type PortForwardInfo } from "./port-forward-manager.js";

const temporaryDirs: string[] = [];

async function makeStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "paseo-port-forward-"));
  temporaryDirs.push(dir);
  return join(dir, "port-forwards.json");
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

async function removeDirWithRetry(dir: string): Promise<void> {
  // create()/delete() schedule an atomic write (temp file + rename) after they
  // return. If teardown races that write, the directory still holds a .tmp file
  // and rmdir reports ENOTEMPTY. Retry briefly so cleanup is deterministic
  // without forcing a flush method into the production API.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await rm(dir, { recursive: true, force: true });
}

afterEach(async () => {
  await Promise.all(temporaryDirs.map((dir) => removeDirWithRetry(dir)));
  temporaryDirs.length = 0;
});

describe("createPortForwardManager", () => {
  it("creates and lists port forwards", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });

    const created = manager.create({ localPort: 3000, remotePort: 8080, label: "web" });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.localPort).toBe(3000);
    expect(created.remotePort).toBe(8080);
    expect(created.label).toBe("web");
    expect(typeof created.createdAt).toBe("number");

    const all = manager.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(created);
  });

  it("creates a forward without a label", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });

    const created = manager.create({ localPort: 5173, remotePort: 5173 });
    expect(created.label).toBeUndefined();
    expect(manager.list()).toHaveLength(1);
  });

  it("deletes a port forward by id and reports whether it existed", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });

    const created = manager.create({ localPort: 3000, remotePort: 8080 });
    expect(manager.delete(created.id)).toBe(true);
    expect(manager.list()).toHaveLength(0);

    expect(manager.delete(created.id)).toBe(false);
    expect(manager.delete("does-not-exist")).toBe(false);
  });

  it("rejects a duplicate local port", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });

    manager.create({ localPort: 3000, remotePort: 8080 });
    expect(() => manager.create({ localPort: 3000, remotePort: 9090 })).toThrow(/local port 3000/);

    // The same remote port on a different local port is allowed.
    const second = manager.create({ localPort: 3001, remotePort: 8080 });
    expect(second.localPort).toBe(3001);
    expect(manager.list()).toHaveLength(2);
  });

  it("rejects out-of-range ports", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });

    expect(() => manager.create({ localPort: 0, remotePort: 8080 })).toThrow(/localPort/);
    expect(() => manager.create({ localPort: 70000, remotePort: 8080 })).toThrow(/localPort/);
    expect(() => manager.create({ localPort: 3000, remotePort: 0 })).toThrow(/remotePort/);
    expect(() => manager.create({ localPort: 3000, remotePort: 70000 })).toThrow(/remotePort/);
    expect(manager.list()).toHaveLength(0);
  });

  it("persists across instances sharing a store path", async () => {
    const storePath = await makeStorePath();
    const first = createPortForwardManager({ storePath });

    const a = first.create({ localPort: 3000, remotePort: 8080, label: "api" });
    const b = first.create({ localPort: 4000, remotePort: 9090 });

    // The atomic write is scheduled asynchronously after create() returns.
    await waitForCondition(() => existsSync(storePath));

    const second = createPortForwardManager({ storePath });
    const reloaded = second.list();
    expect(reloaded).toHaveLength(2);
    const reloadedById = new Map(reloaded.map((forward) => [forward.id, forward]));
    expect(reloadedById.get(a.id)).toEqual(a);
    expect(reloadedById.get(b.id)).toEqual(b);
  });

  it("persists deletions across instances", async () => {
    const storePath = await makeStorePath();
    const first = createPortForwardManager({ storePath });
    const a = first.create({ localPort: 3000, remotePort: 8080 });
    const b = first.create({ localPort: 4000, remotePort: 9090 });
    await waitForCondition(() => existsSync(storePath));

    first.delete(a.id);
    await waitForCondition(() => {
      const reloaded = createPortForwardManager({ storePath }).list();
      return reloaded.length === 1 && reloaded[0]?.id === b.id;
    });
  });

  it("starts from an empty list when the store file is corrupt", async () => {
    const storePath = await makeStorePath();
    await writeFile(storePath, "{ not valid json", "utf8");

    const manager = createPortForwardManager({ storePath });
    expect(manager.list()).toHaveLength(0);

    // It can still create on top of the discarded contents.
    const created = manager.create({ localPort: 3000, remotePort: 8080 });
    expect(manager.list()).toEqual([created]);
  });

  it("fans out current list to subscribers on create and delete", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });
    const events: PortForwardInfo[][] = [];
    manager.subscribeChanged((forwards) => {
      events.push(forwards);
    });

    const created = manager.create({ localPort: 3000, remotePort: 8080 });
    manager.delete(created.id);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual([created]);
    expect(events[1]).toEqual([]);
  });

  it("does not emit when delete removes nothing", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });
    const events: PortForwardInfo[][] = [];
    manager.subscribeChanged((forwards) => {
      events.push(forwards);
    });

    expect(manager.delete("missing")).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("stops notifying after unsubscribe", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });
    const events: PortForwardInfo[][] = [];
    const unsubscribe = manager.subscribeChanged((forwards) => {
      events.push(forwards);
    });

    manager.create({ localPort: 3000, remotePort: 8080 });
    expect(events).toHaveLength(1);

    unsubscribe();
    manager.create({ localPort: 3001, remotePort: 8081 });
    expect(events).toHaveLength(1);
  });

  it("clears subscribers on dispose", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });
    const events: PortForwardInfo[][] = [];
    manager.subscribeChanged((forwards) => {
      events.push(forwards);
    });

    manager.dispose();
    manager.create({ localPort: 3000, remotePort: 8080 });
    expect(events).toHaveLength(0);
  });

  it("isolates multiple subscribers and fans out to each", async () => {
    const manager = createPortForwardManager({ storePath: await makeStorePath() });
    let firstCount = 0;
    let secondCount = 0;
    manager.subscribeChanged(() => {
      firstCount++;
    });
    const unsubscribeSecond = manager.subscribeChanged(() => {
      secondCount++;
    });

    manager.create({ localPort: 3000, remotePort: 8080 });
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);

    unsubscribeSecond();
    manager.create({ localPort: 3001, remotePort: 8081 });
    expect(firstCount).toBe(2);
    expect(secondCount).toBe(1);
  });
});
