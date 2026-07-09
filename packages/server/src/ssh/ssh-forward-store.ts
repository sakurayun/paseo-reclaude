import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  SshForwardInfoSchema,
  type SshForwardInfo,
  type SshForwardRuntime,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../server/atomic-file.js";
import { createPersistQueue, loadJsonFile, notifyListeners } from "./ssh-store-util.js";

const ForwardsFileSchema = z.object({
  forwards: z.array(SshForwardInfoSchema).optional(),
});

export interface SshForwardsSnapshot {
  forwards: SshForwardInfo[];
  runtime: SshForwardRuntime[];
}

export type SshForwardsChangedListener = (snapshot: SshForwardsSnapshot) => void;

export interface SshForwardCreateInput {
  hostId: string;
  forwardType: "local" | "remote" | "dynamic";
  label?: string;
  bindAddress?: string;
  listenPort: number;
  targetHost?: string;
  targetPort?: number;
  autoStart?: boolean;
}

export type SshForwardUpdateInput = Partial<SshForwardCreateInput>;

export interface SshForwardStore {
  list(): SshForwardsSnapshot;
  getForward(id: string): SshForwardInfo | undefined;
  create(input: SshForwardCreateInput): SshForwardInfo;
  update(id: string, input: SshForwardUpdateInput): SshForwardInfo | undefined;
  delete(id: string): boolean;
  // Runtime state is owned by the forward runtime (P5), not persisted.
  setRuntime(id: string, status: SshForwardRuntime["status"], error?: string | null): void;
  clearRuntime(id: string): void;
  subscribeChanged(listener: SshForwardsChangedListener): () => void;
  dispose(): void;
}

export interface SshForwardStoreOptions {
  storePath: string;
}

export function createSshForwardStore(options: SshForwardStoreOptions): SshForwardStore {
  const { storePath } = options;
  const forwardsById = new Map<string, SshForwardInfo>();
  const runtimeById = new Map<string, SshForwardRuntime>();
  const listeners = new Set<SshForwardsChangedListener>();

  for (const forward of loadJsonFile(storePath, ForwardsFileSchema, {}).forwards ?? []) {
    forwardsById.set(forward.id, forward);
  }

  let disposed = false;
  const persist = createPersistQueue(() =>
    writeJsonFileAtomic(storePath, { forwards: Array.from(forwardsById.values()) }),
  );

  function runtimeFor(id: string): SshForwardRuntime {
    return runtimeById.get(id) ?? { id, status: "stopped", error: null };
  }

  function snapshot(): SshForwardsSnapshot {
    const forwards = Array.from(forwardsById.values());
    return {
      forwards,
      runtime: forwards.map((forward) => runtimeFor(forward.id)),
    };
  }

  function emitChanged(): void {
    if (listeners.size === 0) {
      return;
    }
    notifyListeners(listeners, snapshot());
  }

  function buildRecord(
    id: string,
    input: SshForwardCreateInput,
    createdAt: number,
  ): SshForwardInfo {
    const record: SshForwardInfo = {
      id,
      hostId: input.hostId,
      forwardType: input.forwardType,
      listenPort: input.listenPort,
      createdAt,
    };
    if (input.label !== undefined) record.label = input.label;
    if (input.bindAddress !== undefined) record.bindAddress = input.bindAddress;
    if (input.targetHost !== undefined) record.targetHost = input.targetHost;
    if (input.targetPort !== undefined) record.targetPort = input.targetPort;
    if (input.autoStart !== undefined) record.autoStart = input.autoStart;
    return record;
  }

  return {
    list(): SshForwardsSnapshot {
      return snapshot();
    },

    getForward(id: string): SshForwardInfo | undefined {
      return forwardsById.get(id);
    },

    create(input: SshForwardCreateInput): SshForwardInfo {
      const record = buildRecord(randomUUID(), input, Date.now());
      forwardsById.set(record.id, record);
      persist();
      emitChanged();
      return record;
    },

    update(id: string, input: SshForwardUpdateInput): SshForwardInfo | undefined {
      const existing = forwardsById.get(id);
      if (!existing) {
        return undefined;
      }
      const merged: SshForwardInfo = {
        ...existing,
        ...input,
        id,
        hostId: input.hostId ?? existing.hostId,
      };
      forwardsById.set(id, merged);
      persist();
      emitChanged();
      return merged;
    },

    delete(id: string): boolean {
      const removed = forwardsById.delete(id);
      if (removed) {
        runtimeById.delete(id);
        persist();
        emitChanged();
      }
      return removed;
    },

    setRuntime(id, status, error): void {
      runtimeById.set(id, { id, status, error: error ?? null });
      emitChanged();
    },

    clearRuntime(id: string): void {
      if (runtimeById.delete(id)) {
        emitChanged();
      }
    },

    subscribeChanged(listener: SshForwardsChangedListener): () => void {
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
