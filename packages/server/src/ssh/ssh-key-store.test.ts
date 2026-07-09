import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSshKeyStore } from "./ssh-key-store.js";

function tempStorePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "ssh-keys-")), "ssh-keys.json");
}

// Throwaway test-only fixture (never used anywhere real).
const ED25519_PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtwAAAJhh+/+BYfv/
gQAAAAtzc2gtZWQyNTUxOQAAACDWB6i3WomqZly5SnzNyvsJQYBWoyoJop9sMhfhvNgPtw
AAAEAmtyzHID7Fl+E4K5B6NG4CIy+Qcm0l4s435WpeV0I3/dYHqLdaiapmXLlKfM3K+wlB
gFajKgmin2wyF+G82A+3AAAAEnBhc2VvLXRlc3QtZml4dHVyZQECAw==
-----END OPENSSH PRIVATE KEY-----`;

describe("createSshKeyStore", () => {
  const stores: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.dispose();
    }
  });

  it("detects the key type and never exposes private material on the wire shape", () => {
    const storePath = tempStorePath();
    const store = createSshKeyStore({ storePath });
    stores.push(store);

    const key = store.create({ label: "test", privateKey: ED25519_PRIVATE_KEY });
    expect(key.keyType).toBe("ssh-ed25519");
    expect(key.hasCertificate).toBe(false);
    expect(key.hasPassphrase).toBe(false);
    expect(JSON.stringify(store.list())).not.toContain("OPENSSH PRIVATE KEY");
    // Material is retrievable internally for the connection layer.
    expect(store.getMaterial(key.id)?.privateKey).toContain("OPENSSH PRIVATE KEY");
  });

  it("persists with 0o600 permissions and reloads across instances", () => {
    const storePath = tempStorePath();
    const store = createSshKeyStore({ storePath });
    const created = store.create({ label: "test", privateKey: ED25519_PRIVATE_KEY });
    store.dispose();

    if (process.platform !== "win32") {
      expect(statSync(storePath).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(storePath, "utf8")).toContain("OPENSSH PRIVATE KEY");

    const reopened = createSshKeyStore({ storePath });
    stores.push(reopened);
    expect(reopened.getMaterial(created.id)?.privateKey).toBe(ED25519_PRIVATE_KEY);
  });

  it("reports unknown type for unparseable keys instead of throwing", () => {
    const store = createSshKeyStore({ storePath: tempStorePath() });
    stores.push(store);
    const key = store.create({ label: "garbage", privateKey: "not a key at all" });
    expect(key.keyType).toBeUndefined();
  });

  it("update keeps omitted fields, clears null fields, replaces provided fields", () => {
    const store = createSshKeyStore({ storePath: tempStorePath() });
    stores.push(store);
    const key = store.create({
      label: "test",
      privateKey: ED25519_PRIVATE_KEY,
      passphrase: "pp",
      publicKey: "ssh-ed25519 AAA test",
    });

    const renamed = store.update({ id: key.id, label: "renamed" });
    expect(renamed?.hasPassphrase).toBe(true);
    expect(renamed?.publicKey).toBe("ssh-ed25519 AAA test");

    const cleared = store.update({ id: key.id, passphrase: null, publicKey: null });
    expect(cleared?.hasPassphrase).toBe(false);
    expect(cleared?.publicKey).toBeUndefined();
  });
});
