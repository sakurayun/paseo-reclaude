import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { SshKnownHostInfoSchema, type SshKnownHostInfo } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../server/atomic-file.js";
import { createPersistQueue, loadJsonFile, notifyListeners } from "./ssh-store-util.js";

const KnownHostsFileSchema = z.object({
  knownHosts: z.array(SshKnownHostInfoSchema).optional(),
});

export type SshKnownHostsChangedListener = (knownHosts: SshKnownHostInfo[]) => void;

export interface ObservedHostKey {
  host: string;
  port?: number;
  keyType: string;
  // Raw host key bytes as presented by the server.
  publicKey: Buffer;
}

// TOFU verdict returned to the ssh2 hostVerifier.
export type HostKeyVerdict =
  | { outcome: "trusted" }
  | { outcome: "recorded" } // first sighting — recorded and accepted
  | { outcome: "mismatch"; storedFingerprint: string };

export interface SshKnownHostStore {
  list(): SshKnownHostInfo[];
  // Verify an observed key against the record (TOFU). First sighting records
  // and accepts; a changed key is rejected with the stored fingerprint.
  verify(observed: ObservedHostKey): HostKeyVerdict;
  // Explicitly trust a (possibly changed) key — used after the user confirms a
  // fingerprint mismatch in the UI.
  trust(input: {
    host: string;
    port?: number;
    keyType: string;
    publicKey: Buffer;
  }): SshKnownHostInfo;
  delete(id: string): boolean;
  importFromFile(filePath?: string): { imported: number; skipped: number };
  subscribeChanged(listener: SshKnownHostsChangedListener): () => void;
  dispose(): void;
}

export interface SshKnownHostStoreOptions {
  storePath: string;
}

export function fingerprintSha256(publicKey: Buffer): string {
  return `SHA256:${createHash("sha256").update(publicKey).digest("base64").replace(/=+$/, "")}`;
}

function keyId(host: string, port: number | undefined, keyType: string): string {
  return `${host}:${port ?? 22}:${keyType}`;
}

export function createSshKnownHostStore(options: SshKnownHostStoreOptions): SshKnownHostStore {
  const { storePath } = options;
  // Keyed by host:port:keyType so re-observing the same key updates in place.
  const byKey = new Map<string, SshKnownHostInfo>();
  const listeners = new Set<SshKnownHostsChangedListener>();

  for (const entry of loadJsonFile(storePath, KnownHostsFileSchema, {}).knownHosts ?? []) {
    byKey.set(keyId(entry.host, entry.port, entry.keyType), entry);
  }

  let disposed = false;
  const persist = createPersistQueue(() =>
    writeJsonFileAtomic(storePath, { knownHosts: Array.from(byKey.values()) }),
  );

  function snapshot(): SshKnownHostInfo[] {
    return Array.from(byKey.values());
  }

  function emitChanged(): void {
    if (listeners.size === 0) {
      return;
    }
    notifyListeners(listeners, snapshot());
  }

  function record(input: {
    host: string;
    port?: number;
    keyType: string;
    publicKey: Buffer;
    source: "tofu" | "imported";
  }): SshKnownHostInfo {
    const now = Date.now();
    const id = keyId(input.host, input.port, input.keyType);
    const existing = byKey.get(id);
    const entry: SshKnownHostInfo = {
      id: existing?.id ?? randomUUID(),
      host: input.host,
      keyType: input.keyType,
      fingerprintSha256: fingerprintSha256(input.publicKey),
      publicKeyBase64: input.publicKey.toString("base64"),
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      source: input.source,
    };
    if (input.port !== undefined) {
      entry.port = input.port;
    }
    byKey.set(id, entry);
    return entry;
  }

  return {
    list(): SshKnownHostInfo[] {
      return snapshot();
    },

    verify(observed: ObservedHostKey): HostKeyVerdict {
      const id = keyId(observed.host, observed.port, observed.keyType);
      const existing = byKey.get(id);
      const observedFingerprint = fingerprintSha256(observed.publicKey);
      if (!existing) {
        record({ ...observed, source: "tofu" });
        persist();
        emitChanged();
        return { outcome: "recorded" };
      }
      if (existing.fingerprintSha256 === observedFingerprint) {
        // Touch lastSeenAt without emitting a noisy change for an unchanged key.
        byKey.set(id, { ...existing, lastSeenAt: Date.now() });
        persist();
        return { outcome: "trusted" };
      }
      return { outcome: "mismatch", storedFingerprint: existing.fingerprintSha256 };
    },

    trust(input): SshKnownHostInfo {
      const entry = record({ ...input, source: "tofu" });
      persist();
      emitChanged();
      return entry;
    },

    delete(id: string): boolean {
      for (const [key, entry] of byKey) {
        if (entry.id === id) {
          byKey.delete(key);
          persist();
          emitChanged();
          return true;
        }
      }
      return false;
    },

    importFromFile(filePath?: string): { imported: number; skipped: number } {
      const target = filePath ?? path.join(homedir(), ".ssh", "known_hosts");
      let content: string;
      try {
        content = readFileSync(target, "utf8");
      } catch {
        return { imported: 0, skipped: 0 };
      }
      let imported = 0;
      let skipped = 0;
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) {
          continue;
        }
        const parsed = parseKnownHostsLine(line);
        if (!parsed) {
          skipped += 1;
          continue;
        }
        record({ ...parsed, source: "imported" });
        imported += 1;
      }
      if (imported > 0) {
        persist();
        emitChanged();
      }
      return { imported, skipped };
    },

    subscribeChanged(listener: SshKnownHostsChangedListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      listeners.clear();
    },
  };
}

// Parses a single known_hosts line: `<hosts> <keytype> <base64key> [comment]`.
// Hashed host entries (`|1|...`) and marker lines (`@cert-authority`, `@revoked`)
// are skipped — we can't map a hashed hostname back to a display value.
function parseKnownHostsLine(
  line: string,
): { host: string; port?: number; keyType: string; publicKey: Buffer } | undefined {
  const parts = line.split(/\s+/);
  if (parts.length < 3) {
    return undefined;
  }
  let index = 0;
  if (parts[0]?.startsWith("@")) {
    index = 1;
  }
  const hostField = parts[index];
  const keyType = parts[index + 1];
  const base64Key = parts[index + 2];
  if (!hostField || !keyType || !base64Key || hostField.startsWith("|")) {
    return undefined;
  }
  // The host field may hold a comma-separated list; take the first entry.
  const firstHost = hostField.split(",")[0] ?? hostField;
  const { host, port } = splitHostPort(firstHost);
  let publicKey: Buffer;
  try {
    publicKey = Buffer.from(base64Key, "base64");
  } catch {
    return undefined;
  }
  if (publicKey.length === 0) {
    return undefined;
  }
  return port !== undefined ? { host, port, keyType, publicKey } : { host, keyType, publicKey };
}

// `[host]:port` -> { host, port }; bare host -> { host }.
function splitHostPort(value: string): { host: string; port?: number } {
  const bracketed = value.match(/^\[(.+)\]:(\d+)$/);
  if (bracketed?.[1] && bracketed[2]) {
    return { host: bracketed[1], port: Number.parseInt(bracketed[2], 10) };
  }
  return { host: value };
}
