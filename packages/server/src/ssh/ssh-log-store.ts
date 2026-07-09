import { randomUUID } from "node:crypto";
import { z } from "zod";

import { SshLogEntrySchema, type SshLogEntry } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../server/atomic-file.js";
import { createPersistQueue, loadJsonFile, notifyListeners } from "./ssh-store-util.js";

const LogsFileSchema = z.object({
  entries: z.array(SshLogEntrySchema).optional(),
});

const MAX_ENTRIES = 500;

export type SshLogUpdatedListener = (entry: SshLogEntry) => void;

export interface SshLogStore {
  list(limit?: number): SshLogEntry[];
  // Records a connection start; returns the entry id for later completion.
  begin(input: {
    hostId: string;
    hostLabel: string;
    username?: string;
    address: string;
    port?: number;
    protocol: "ssh" | "mosh";
  }): string;
  // Marks an in-flight entry connected (handshake succeeded).
  markConnected(id: string): void;
  // Completes an entry (closed cleanly or failed).
  complete(id: string, input: { status: "failed" | "closed"; error?: string }): void;
  subscribeUpdated(listener: SshLogUpdatedListener): () => void;
  dispose(): void;
}

export interface SshLogStoreOptions {
  storePath: string;
}

export function createSshLogStore(options: SshLogStoreOptions): SshLogStore {
  const { storePath } = options;
  // Newest first. Bounded to MAX_ENTRIES (ring buffer).
  const entries: SshLogEntry[] = loadJsonFile(storePath, LogsFileSchema, {}).entries ?? [];
  const listeners = new Set<SshLogUpdatedListener>();

  let disposed = false;
  const persist = createPersistQueue(() =>
    writeJsonFileAtomic(storePath, { entries: entries.slice(0, MAX_ENTRIES) }),
  );

  function emitUpdated(entry: SshLogEntry): void {
    if (listeners.size === 0) {
      return;
    }
    notifyListeners(listeners, entry);
  }

  function replace(id: string, next: (entry: SshLogEntry) => SshLogEntry): void {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return;
    }
    const updated = next(entries[index] as SshLogEntry);
    entries[index] = updated;
    persist();
    emitUpdated(updated);
  }

  return {
    list(limit?: number): SshLogEntry[] {
      return limit !== undefined ? entries.slice(0, limit) : entries.slice();
    },

    begin(input): string {
      const entry: SshLogEntry = {
        id: randomUUID(),
        hostId: input.hostId,
        hostLabel: input.hostLabel,
        address: input.address,
        protocol: input.protocol,
        startedAt: Date.now(),
        endedAt: null,
        durationMs: null,
        status: "failed", // pessimistic default until markConnected/complete
      };
      if (input.username !== undefined) {
        entry.username = input.username;
      }
      if (input.port !== undefined) {
        entry.port = input.port;
      }
      entries.unshift(entry);
      if (entries.length > MAX_ENTRIES) {
        entries.length = MAX_ENTRIES;
      }
      persist();
      emitUpdated(entry);
      return entry.id;
    },

    markConnected(id: string): void {
      replace(id, (entry) => ({ ...entry, status: "connected" }));
    },

    complete(id, input): void {
      replace(id, (entry) => {
        const endedAt = Date.now();
        const completed: SshLogEntry = {
          ...entry,
          status: input.status,
          endedAt,
          durationMs: endedAt - entry.startedAt,
        };
        if (input.error !== undefined) {
          completed.error = input.error;
        }
        return completed;
      });
    },

    subscribeUpdated(listener: SshLogUpdatedListener): () => void {
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
