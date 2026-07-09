import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  SshHostGroupSchema,
  SshHostInfoSchema,
  type SshHostGroup,
  type SshHostInfo,
  type SshHostPatch,
  type SshHostPlatform,
  type SshHostUpsert,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../server/atomic-file.js";
import { writePrivateFileAtomicSync } from "../server/private-files.js";
import { createPersistQueue, loadJsonFile, notifyListeners } from "./ssh-store-util.js";

// On-disk host record: the full wire shape minus the derived `hasPassword`
// flag (passwords live only in the 0o600 secrets file, never here).
const StoredHostSchema = SshHostInfoSchema.omit({ hasPassword: true });
type StoredHost = z.infer<typeof StoredHostSchema>;

const HostsFileSchema = z.object({
  groups: z.array(SshHostGroupSchema).optional(),
  hosts: z.array(StoredHostSchema).optional(),
});

// Secrets file is written with 0o600 and never leaves the daemon.
const SecretsFileSchema = z.object({
  hostPasswords: z.record(z.string(), z.string()).optional(),
  proxyPasswords: z.record(z.string(), z.string()).optional(),
});

export interface SshHostsSnapshot {
  hosts: SshHostInfo[];
  groups: SshHostGroup[];
}

export type SshHostsChangedListener = (snapshot: SshHostsSnapshot) => void;

// Resolved secrets used by the connection layer (never serialized to wire).
export interface SshHostSecrets {
  password?: string;
  proxyPassword?: string;
}

export interface SshHostStore {
  list(): SshHostsSnapshot;
  getHost(id: string): SshHostInfo | undefined;
  getSecrets(id: string): SshHostSecrets;
  createHost(input: {
    host: SshHostUpsert;
    password?: string;
    proxyPassword?: string;
  }): SshHostInfo;
  updateHost(input: {
    id: string;
    host: SshHostPatch;
    password?: string | null;
    proxyPassword?: string | null;
  }): SshHostInfo | undefined;
  deleteHost(id: string): boolean;
  setPlatform(id: string, platform: SshHostPlatform): void;
  createGroup(input: { name: string; parentId?: string | null }): SshHostGroup;
  renameGroup(id: string, name: string): SshHostGroup | undefined;
  deleteGroup(id: string): boolean;
  subscribeChanged(listener: SshHostsChangedListener): () => void;
  dispose(): void;
}

export interface SshHostStoreOptions {
  hostsPath: string;
  secretsPath: string;
}

export function createSshHostStore(options: SshHostStoreOptions): SshHostStore {
  const { hostsPath, secretsPath } = options;

  const hostsById = new Map<string, StoredHost>();
  const groupsById = new Map<string, SshHostGroup>();
  const hostPasswords = new Map<string, string>();
  const proxyPasswords = new Map<string, string>();
  const listeners = new Set<SshHostsChangedListener>();

  const hostsFile = loadJsonFile(hostsPath, HostsFileSchema, {});
  for (const group of hostsFile.groups ?? []) {
    groupsById.set(group.id, group);
  }
  for (const host of hostsFile.hosts ?? []) {
    hostsById.set(host.id, host);
  }
  const secretsFile = loadJsonFile(secretsPath, SecretsFileSchema, {});
  for (const [id, value] of Object.entries(secretsFile.hostPasswords ?? {})) {
    hostPasswords.set(id, value);
  }
  for (const [id, value] of Object.entries(secretsFile.proxyPasswords ?? {})) {
    proxyPasswords.set(id, value);
  }

  let disposed = false;

  const persistHosts = createPersistQueue(() =>
    writeJsonFileAtomic(hostsPath, {
      groups: Array.from(groupsById.values()),
      hosts: Array.from(hostsById.values()),
    }),
  );

  // Secrets are written synchronously via the 0o600 helper. The file is tiny
  // and this keeps the private-mode guarantee simple (no async temp races).
  function persistSecrets(): void {
    const payload = {
      hostPasswords: Object.fromEntries(hostPasswords),
      proxyPasswords: Object.fromEntries(proxyPasswords),
    };
    try {
      writePrivateFileAtomicSync(secretsPath, JSON.stringify(payload));
    } catch {
      // Best-effort, matching the persistence contract of the other stores.
    }
  }

  function toWire(host: StoredHost): SshHostInfo {
    return { ...host, hasPassword: hostPasswords.has(host.id) };
  }

  function snapshot(): SshHostsSnapshot {
    return {
      hosts: Array.from(hostsById.values()).map(toWire),
      groups: Array.from(groupsById.values()),
    };
  }

  function emitChanged(): void {
    if (listeners.size === 0) {
      return;
    }
    notifyListeners(listeners, snapshot());
  }

  return {
    list(): SshHostsSnapshot {
      return snapshot();
    },

    getHost(id: string): SshHostInfo | undefined {
      const host = hostsById.get(id);
      return host ? toWire(host) : undefined;
    },

    getSecrets(id: string): SshHostSecrets {
      const secrets: SshHostSecrets = {};
      const password = hostPasswords.get(id);
      if (password !== undefined) {
        secrets.password = password;
      }
      const proxyPassword = proxyPasswords.get(id);
      if (proxyPassword !== undefined) {
        secrets.proxyPassword = proxyPassword;
      }
      return secrets;
    },

    createHost(input): SshHostInfo {
      const now = Date.now();
      const id = randomUUID();
      const stored: StoredHost = {
        ...input.host,
        id,
        createdAt: now,
        updatedAt: now,
      };
      hostsById.set(id, stored);
      if (input.password) {
        hostPasswords.set(id, input.password);
      }
      if (input.proxyPassword) {
        proxyPasswords.set(id, input.proxyPassword);
      }
      persistHosts();
      persistSecrets();
      emitChanged();
      return toWire(stored);
    },

    updateHost(input): SshHostInfo | undefined {
      const existing = hostsById.get(input.id);
      if (!existing) {
        return undefined;
      }
      const merged: StoredHost = {
        ...existing,
        ...input.host,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      hostsById.set(input.id, merged);

      let secretsChanged = false;
      if (input.password === null) {
        secretsChanged = hostPasswords.delete(input.id) || secretsChanged;
      } else if (typeof input.password === "string") {
        hostPasswords.set(input.id, input.password);
        secretsChanged = true;
      }
      if (input.proxyPassword === null) {
        secretsChanged = proxyPasswords.delete(input.id) || secretsChanged;
      } else if (typeof input.proxyPassword === "string") {
        proxyPasswords.set(input.id, input.proxyPassword);
        secretsChanged = true;
      }

      persistHosts();
      if (secretsChanged) {
        persistSecrets();
      }
      emitChanged();
      return toWire(merged);
    },

    deleteHost(id: string): boolean {
      const removed = hostsById.delete(id);
      if (!removed) {
        return false;
      }
      const hadSecret = hostPasswords.delete(id) || proxyPasswords.delete(id);
      persistHosts();
      if (hadSecret) {
        persistSecrets();
      }
      emitChanged();
      return true;
    },

    setPlatform(id: string, platform: SshHostPlatform): void {
      const existing = hostsById.get(id);
      if (!existing) {
        return;
      }
      hostsById.set(id, { ...existing, platform });
      persistHosts();
      emitChanged();
    },

    createGroup(input): SshHostGroup {
      const group: SshHostGroup = {
        id: randomUUID(),
        name: input.name,
        parentId: input.parentId ?? null,
      };
      groupsById.set(group.id, group);
      persistHosts();
      emitChanged();
      return group;
    },

    renameGroup(id: string, name: string): SshHostGroup | undefined {
      const existing = groupsById.get(id);
      if (!existing) {
        return undefined;
      }
      const renamed: SshHostGroup = { ...existing, name };
      groupsById.set(id, renamed);
      persistHosts();
      emitChanged();
      return renamed;
    },

    deleteGroup(id: string): boolean {
      const removed = groupsById.delete(id);
      if (!removed) {
        return false;
      }
      // Orphan the hosts (and any child groups) rather than cascade-deleting:
      // losing a group must never silently drop saved hosts.
      for (const [hostId, host] of hostsById) {
        if (host.groupId === id) {
          hostsById.set(hostId, { ...host, groupId: null });
        }
      }
      for (const [groupId, group] of groupsById) {
        if (group.parentId === id) {
          groupsById.set(groupId, { ...group, parentId: null });
        }
      }
      persistHosts();
      emitChanged();
      return true;
    },

    subscribeChanged(listener: SshHostsChangedListener): () => void {
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
