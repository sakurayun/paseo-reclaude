import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { PortForwardInfoSchema, type PortForwardInfo } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../server/atomic-file.js";

export type { PortForwardInfo } from "@getpaseo/protocol/messages";

export type PortForwardsChangedListener = (forwards: PortForwardInfo[]) => void;

export interface PortForwardManager {
  list(): PortForwardInfo[];
  create(input: { localPort: number; remotePort: number; label?: string }): PortForwardInfo;
  delete(id: string): boolean;
  subscribeChanged(listener: PortForwardsChangedListener): () => void;
  dispose(): void;
}

export interface PortForwardManagerOptions {
  storePath: string;
}

const MIN_PORT = 1;
const MAX_PORT = 65535;

// The store file is a plain array of port-forward records. Parsing is tolerant:
// a corrupt or partially-written file must not crash the daemon — we start from
// an empty list and let the next mutation rewrite a clean file.
const StoredPortForwardsSchema = z.array(PortForwardInfoSchema);

function assertValidPort(value: number, field: "localPort" | "remotePort"): void {
  if (!Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT) {
    throw new Error(
      `${field} must be an integer between ${MIN_PORT} and ${MAX_PORT}, got ${value}`,
    );
  }
}

function loadFromDisk(storePath: string): PortForwardInfo[] {
  let content: string;
  try {
    content = readFileSync(storePath, "utf8");
  } catch (error) {
    // Missing file is the normal first-run case; anything else (permissions,
    // etc.) also degrades to an empty list rather than failing daemon startup.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    return [];
  }

  try {
    const parsed = StoredPortForwardsSchema.parse(JSON.parse(content));
    return parsed;
  } catch {
    // Corrupt JSON or schema mismatch: drop the bad contents instead of crashing.
    return [];
  }
}

export function createPortForwardManager(options: PortForwardManagerOptions): PortForwardManager {
  const { storePath } = options;
  const forwardsById = new Map<string, PortForwardInfo>();
  const listeners = new Set<PortForwardsChangedListener>();

  for (const forward of loadFromDisk(storePath)) {
    forwardsById.set(forward.id, forward);
  }

  // Serialize writes so concurrent create/delete calls can't interleave their
  // atomic renames. Each mutation chains onto the previous persist.
  let persistQueue: Promise<void> = Promise.resolve();
  let disposed = false;

  function snapshot(): PortForwardInfo[] {
    return Array.from(forwardsById.values());
  }

  function persist(): void {
    const records = snapshot();
    persistQueue = persistQueue
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(storePath, records))
      .catch(() => {
        // Persistence is best-effort; an I/O failure must not throw into the
        // synchronous create/delete caller or reject an unhandled promise.
      });
  }

  function emitChanged(): void {
    if (listeners.size === 0) {
      return;
    }
    const forwards = snapshot();
    for (const listener of listeners) {
      try {
        listener(forwards);
      } catch {
        // A misbehaving listener must not break fan-out to the others.
      }
    }
  }

  return {
    list(): PortForwardInfo[] {
      return snapshot();
    },

    create(input: { localPort: number; remotePort: number; label?: string }): PortForwardInfo {
      assertValidPort(input.localPort, "localPort");
      assertValidPort(input.remotePort, "remotePort");

      for (const existing of forwardsById.values()) {
        if (existing.localPort === input.localPort) {
          throw new Error(`A port forward for local port ${input.localPort} already exists`);
        }
      }

      const forward: PortForwardInfo = {
        id: randomUUID(),
        localPort: input.localPort,
        remotePort: input.remotePort,
        ...(input.label !== undefined ? { label: input.label } : {}),
        createdAt: Date.now(),
      };
      forwardsById.set(forward.id, forward);
      persist();
      emitChanged();
      return forward;
    },

    delete(id: string): boolean {
      const removed = forwardsById.delete(id);
      if (removed) {
        persist();
        emitChanged();
      }
      return removed;
    },

    subscribeChanged(listener: PortForwardsChangedListener): () => void {
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
