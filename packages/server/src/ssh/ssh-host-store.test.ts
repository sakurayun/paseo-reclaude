import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSshHostStore } from "./ssh-host-store.js";

function tempPaths(): { dir: string; hostsPath: string; secretsPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ssh-host-store-"));
  return {
    dir,
    hostsPath: path.join(dir, "ssh-hosts.json"),
    secretsPath: path.join(dir, "ssh-secrets.json"),
  };
}

// The hosts file is written through an async persist queue; poll until the
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

describe("createSshHostStore", () => {
  const stores: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.dispose();
    }
  });

  it("creates a host and exposes hasPassword without leaking the password", async () => {
    const { hostsPath, secretsPath } = tempPaths();
    const store = createSshHostStore({ hostsPath, secretsPath });
    stores.push(store);

    const host = store.createHost({
      host: { label: "Box", address: "10.0.0.1", port: 22 },
      password: "s3cret",
    });

    expect(host.hasPassword).toBe(true);
    // Wire shape carries no password field.
    expect(JSON.stringify(host)).not.toContain("s3cret");
    // Secrets are readable back internally.
    expect(store.getSecrets(host.id).password).toBe("s3cret");
    // The hosts file must not contain the password either.
    await waitForFile(hostsPath, (content) => content.includes(host.id));
    expect(readFileSync(hostsPath, "utf8")).not.toContain("s3cret");
  });

  it("writes the secrets file with 0o600 permissions", () => {
    const { hostsPath, secretsPath } = tempPaths();
    const store = createSshHostStore({ hostsPath, secretsPath });
    stores.push(store);
    store.createHost({ host: { label: "Box", address: "10.0.0.1" }, password: "pw" });

    if (process.platform !== "win32") {
      const mode = statSync(secretsPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("keeps the stored password when update omits it, clears it on null", () => {
    const { hostsPath, secretsPath } = tempPaths();
    const store = createSshHostStore({ hostsPath, secretsPath });
    stores.push(store);
    const host = store.createHost({
      host: { label: "Box", address: "10.0.0.1" },
      password: "pw",
    });

    store.updateHost({ id: host.id, host: { label: "Renamed" } });
    expect(store.getSecrets(host.id).password).toBe("pw");
    expect(store.getHost(host.id)?.hasPassword).toBe(true);

    const cleared = store.updateHost({ id: host.id, host: {}, password: null });
    expect(cleared?.hasPassword).toBe(false);
    expect(store.getSecrets(host.id).password).toBeUndefined();
  });

  it("orphans hosts and child groups when a group is deleted", () => {
    const { hostsPath, secretsPath } = tempPaths();
    const store = createSshHostStore({ hostsPath, secretsPath });
    stores.push(store);
    const parent = store.createGroup({ name: "Parent" });
    const child = store.createGroup({ name: "Child", parentId: parent.id });
    const host = store.createHost({
      host: { label: "Box", address: "10.0.0.1", groupId: parent.id },
    });

    expect(store.deleteGroup(parent.id)).toBe(true);
    expect(store.getHost(host.id)?.groupId).toBeNull();
    const snapshot = store.list();
    expect(snapshot.groups.find((g) => g.id === child.id)?.parentId).toBeNull();
  });

  it("recovers to an empty list from a corrupt hosts file", () => {
    const { hostsPath, secretsPath } = tempPaths();
    writeFileSync(hostsPath, "{ this is not json");
    const store = createSshHostStore({ hostsPath, secretsPath });
    stores.push(store);
    expect(store.list().hosts).toEqual([]);
  });

  it("persists and reloads hosts across store instances", async () => {
    const { hostsPath, secretsPath } = tempPaths();
    const store = createSshHostStore({ hostsPath, secretsPath });
    const created = store.createHost({ host: { label: "Box", address: "10.0.0.1" } });
    await waitForFile(hostsPath, (content) => content.includes(created.id));
    store.dispose();

    const reopened = createSshHostStore({ hostsPath, secretsPath });
    stores.push(reopened);
    expect(reopened.getHost(created.id)?.label).toBe("Box");
  });
});
