import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSshForwardStore, type SshForwardsSnapshot } from "./ssh-forward-store.js";

function tempStorePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "ssh-forwards-")), "ssh-forwards.json");
}

// The forwards file is written through an async persist queue; poll until the
// write lands instead of racing it with a fixed delay.
async function waitForFile(
  filePath: string,
  predicate: (content: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      const content = readFileSync(filePath, "utf8");
      if (predicate(content)) {
        return;
      }
    } catch {
      // not written yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("createSshForwardStore", () => {
  const stores: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.dispose();
    }
  });

  it("creates a local forward and reports stopped runtime by default", () => {
    const store = createSshForwardStore({ storePath: tempStorePath() });
    stores.push(store);

    const forward = store.create({
      hostId: "h1",
      forwardType: "local",
      listenPort: 3000,
      bindAddress: "127.0.0.1",
      targetHost: "127.0.0.1",
      targetPort: 3000,
    });
    const snapshot = store.list();
    expect(snapshot.forwards).toHaveLength(1);
    expect(snapshot.runtime).toEqual([{ id: forward.id, status: "stopped", error: null }]);
  });

  it("runtime transitions are broadcast but never persisted", async () => {
    const storePath = tempStorePath();
    const store = createSshForwardStore({ storePath });
    const forward = store.create({ hostId: "h1", forwardType: "dynamic", listenPort: 1080 });

    const seen: SshForwardsSnapshot[] = [];
    const unsubscribe = store.subscribeChanged((snapshot) => seen.push(snapshot));
    store.setRuntime(forward.id, "active");
    expect(seen.at(-1)?.runtime[0]?.status).toBe("active");
    unsubscribe();

    await waitForFile(storePath, (content) => content.includes(forward.id));
    store.dispose();
    const reopened = createSshForwardStore({ storePath });
    stores.push(reopened);
    // Runtime state resets to stopped after a restart.
    expect(reopened.list().runtime[0]?.status).toBe("stopped");
    expect(reopened.list().forwards).toHaveLength(1);
  });

  it("update patches fields and delete clears runtime", () => {
    const store = createSshForwardStore({ storePath: tempStorePath() });
    stores.push(store);

    const forward = store.create({ hostId: "h1", forwardType: "local", listenPort: 3000 });
    const updated = store.update(forward.id, { listenPort: 4000, label: "web" });
    expect(updated?.listenPort).toBe(4000);
    expect(updated?.label).toBe("web");

    store.setRuntime(forward.id, "error", "boom");
    expect(store.delete(forward.id)).toBe(true);
    expect(store.list().forwards).toHaveLength(0);
    expect(store.list().runtime).toHaveLength(0);
  });
});
