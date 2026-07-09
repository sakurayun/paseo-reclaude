import { randomUUID } from "node:crypto";
import { z } from "zod";
// ssh2 is CommonJS with dynamically-assigned named exports that Node's native
// ESM loader can't statically detect — import the default (its module.exports)
// and read `utils` off it so this loads under Electron/native ESM, not just tsx.
import ssh2 from "ssh2";

const { utils: sshUtils } = ssh2;

import type { SshKeyInfo } from "@getpaseo/protocol/messages";
import { writePrivateFileAtomicSync } from "../server/private-files.js";
import { loadJsonFile, notifyListeners } from "./ssh-store-util.js";

// On-disk key record — the whole file is 0o600 and never leaves the daemon.
const StoredKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  privateKey: z.string(),
  publicKey: z.string().optional(),
  certificate: z.string().optional(),
  passphrase: z.string().optional(),
  createdAt: z.number().optional(),
});
type StoredKey = z.infer<typeof StoredKeySchema>;

const KeysFileSchema = z.object({
  keys: z.array(StoredKeySchema).optional(),
});

export interface SshKeyMaterial {
  privateKey: string;
  publicKey?: string;
  certificate?: string;
  passphrase?: string;
}

export type SshKeysChangedListener = (keys: SshKeyInfo[]) => void;

export interface SshKeyStore {
  list(): SshKeyInfo[];
  getMaterial(id: string): SshKeyMaterial | undefined;
  create(input: {
    label: string;
    privateKey: string;
    publicKey?: string;
    certificate?: string;
    passphrase?: string;
  }): SshKeyInfo;
  update(input: {
    id: string;
    label?: string;
    privateKey?: string;
    publicKey?: string | null;
    certificate?: string | null;
    passphrase?: string | null;
  }): SshKeyInfo | undefined;
  delete(id: string): boolean;
  subscribeChanged(listener: SshKeysChangedListener): () => void;
  dispose(): void;
}

export interface SshKeyStoreOptions {
  storePath: string;
}

// Best-effort key-type detection. Encrypted keys without the passphrase can't
// be parsed — that's fine, the type stays unknown and is surfaced as such.
function detectKeyType(privateKey: string, passphrase?: string): string | undefined {
  try {
    const parsed = passphrase
      ? sshUtils.parseKey(privateKey, passphrase)
      : sshUtils.parseKey(privateKey);
    if (parsed instanceof Error) {
      return undefined;
    }
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    return key?.type ?? undefined;
  } catch {
    return undefined;
  }
}

export function createSshKeyStore(options: SshKeyStoreOptions): SshKeyStore {
  const { storePath } = options;
  const keysById = new Map<string, StoredKey>();
  const listeners = new Set<SshKeysChangedListener>();

  for (const key of loadJsonFile(storePath, KeysFileSchema, {}).keys ?? []) {
    keysById.set(key.id, key);
  }

  let disposed = false;

  function persist(): void {
    try {
      writePrivateFileAtomicSync(
        storePath,
        JSON.stringify({ keys: Array.from(keysById.values()) }),
      );
    } catch {
      // Best-effort persistence.
    }
  }

  function toWire(key: StoredKey): SshKeyInfo {
    const keyType = detectKeyType(key.privateKey, key.passphrase);
    const info: SshKeyInfo = {
      id: key.id,
      label: key.label,
      hasCertificate: key.certificate !== undefined,
      hasPassphrase: key.passphrase !== undefined,
    };
    if (keyType !== undefined) {
      info.keyType = keyType;
    }
    if (key.publicKey !== undefined) {
      info.publicKey = key.publicKey;
    }
    if (key.createdAt !== undefined) {
      info.createdAt = key.createdAt;
    }
    return info;
  }

  function snapshot(): SshKeyInfo[] {
    return Array.from(keysById.values()).map(toWire);
  }

  function emitChanged(): void {
    if (listeners.size === 0) {
      return;
    }
    notifyListeners(listeners, snapshot());
  }

  return {
    list(): SshKeyInfo[] {
      return snapshot();
    },

    getMaterial(id: string): SshKeyMaterial | undefined {
      const key = keysById.get(id);
      if (!key) {
        return undefined;
      }
      const material: SshKeyMaterial = { privateKey: key.privateKey };
      if (key.publicKey !== undefined) {
        material.publicKey = key.publicKey;
      }
      if (key.certificate !== undefined) {
        material.certificate = key.certificate;
      }
      if (key.passphrase !== undefined) {
        material.passphrase = key.passphrase;
      }
      return material;
    },

    create(input): SshKeyInfo {
      const stored: StoredKey = {
        id: randomUUID(),
        label: input.label,
        privateKey: input.privateKey,
        createdAt: Date.now(),
      };
      if (input.publicKey !== undefined) {
        stored.publicKey = input.publicKey;
      }
      if (input.certificate !== undefined) {
        stored.certificate = input.certificate;
      }
      if (input.passphrase !== undefined) {
        stored.passphrase = input.passphrase;
      }
      keysById.set(stored.id, stored);
      persist();
      emitChanged();
      return toWire(stored);
    },

    update(input): SshKeyInfo | undefined {
      const existing = keysById.get(input.id);
      if (!existing) {
        return undefined;
      }
      const merged: StoredKey = { ...existing };
      if (input.label !== undefined) {
        merged.label = input.label;
      }
      if (input.privateKey !== undefined) {
        merged.privateKey = input.privateKey;
      }
      applyNullableField(merged, "publicKey", input.publicKey);
      applyNullableField(merged, "certificate", input.certificate);
      applyNullableField(merged, "passphrase", input.passphrase);
      keysById.set(input.id, merged);
      persist();
      emitChanged();
      return toWire(merged);
    },

    delete(id: string): boolean {
      const removed = keysById.delete(id);
      if (removed) {
        persist();
        emitChanged();
      }
      return removed;
    },

    subscribeChanged(listener: SshKeysChangedListener): () => void {
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

// undefined = keep, null = clear, string = replace.
function applyNullableField(
  target: StoredKey,
  field: "publicKey" | "certificate" | "passphrase",
  value: string | null | undefined,
): void {
  if (value === null) {
    delete target[field];
  } else if (typeof value === "string") {
    target[field] = value;
  }
}
