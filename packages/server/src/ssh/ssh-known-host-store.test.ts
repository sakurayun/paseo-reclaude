import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSshKnownHostStore, fingerprintSha256 } from "./ssh-known-host-store.js";

function tempStorePath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "ssh-known-hosts-")), "ssh-known-hosts.json");
}

const KEY_A = Buffer.from("fake-ed25519-key-material-A");
const KEY_B = Buffer.from("fake-ed25519-key-material-B");

describe("createSshKnownHostStore", () => {
  const stores: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.dispose();
    }
  });

  it("records the first sighting (TOFU) and trusts an unchanged key afterwards", () => {
    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);

    const observed = { host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_A };
    expect(store.verify(observed).outcome).toBe("recorded");
    expect(store.list()).toHaveLength(1);
    expect(store.verify(observed).outcome).toBe("trusted");
    expect(store.list()).toHaveLength(1);
  });

  it("rejects a changed key with the stored fingerprint", () => {
    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);

    store.verify({ host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_A });
    const verdict = store.verify({
      host: "10.0.0.1",
      port: 22,
      keyType: "ssh-ed25519",
      publicKey: KEY_B,
    });
    expect(verdict).toEqual({
      outcome: "mismatch",
      storedFingerprint: fingerprintSha256(KEY_A),
    });
  });

  it("trust() replaces a mismatched key so reconnect succeeds", () => {
    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);

    store.verify({ host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_A });
    store.trust({ host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_B });
    expect(
      store.verify({ host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_B })
        .outcome,
    ).toBe("trusted");
    // Same host:port:keyType slot — replaced, not appended.
    expect(store.list()).toHaveLength(1);
  });

  it("treats different ports as separate identities", () => {
    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);

    store.verify({ host: "10.0.0.1", port: 22, keyType: "ssh-ed25519", publicKey: KEY_A });
    expect(
      store.verify({ host: "10.0.0.1", port: 2222, keyType: "ssh-ed25519", publicKey: KEY_B })
        .outcome,
    ).toBe("recorded");
    expect(store.list()).toHaveLength(2);
  });

  it("imports plain openssh known_hosts lines and skips hashed/invalid ones", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "known-hosts-import-"));
    const knownHostsFile = path.join(dir, "known_hosts");
    const b64 = KEY_A.toString("base64");
    writeFileSync(
      knownHostsFile,
      [
        `10.0.0.1 ssh-ed25519 ${b64}`,
        `[10.0.0.2]:2222,10.0.0.2 ssh-rsa ${b64} some-comment`,
        `|1|hashedhostname=|hash= ssh-ed25519 ${b64}`, // hashed → skipped
        "# comment line",
        "not-enough-fields",
      ].join("\n"),
    );

    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);
    const result = store.importFromFile(knownHostsFile);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(2);

    const entries = store.list();
    expect(entries).toHaveLength(2);
    const bracketed = entries.find((entry) => entry.host === "10.0.0.2");
    expect(bracketed?.port).toBe(2222);
    expect(entries.every((entry) => entry.source === "imported")).toBe(true);
  });

  it("returns zero counts when the file is missing", () => {
    const store = createSshKnownHostStore({ storePath: tempStorePath() });
    stores.push(store);
    expect(store.importFromFile("/nonexistent/known_hosts")).toEqual({
      imported: 0,
      skipped: 0,
    });
  });
});
