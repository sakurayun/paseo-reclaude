import { promises as fs } from "node:fs";

import {
  type WorkspaceLayoutEnvelope,
  WorkspaceLayoutEnvelopeSchema,
} from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

export interface ApplyWorkspaceLayoutPushInput {
  workspaceId: string;
  revision: number;
  // Opaque desktop split-tree blob. The daemon never parses it; the app
  // reconstructs runtime state from it via normalizeLayout().
  layout: Record<string, unknown>;
}

export interface ApplyWorkspaceLayoutPushResult {
  // false when the push was rejected as stale (revision <= stored revision).
  accepted: boolean;
  // The store's authoritative envelope after applying (or rejecting) the push.
  current: WorkspaceLayoutEnvelope;
}

export interface WorkspaceLayoutStore {
  initialize(): Promise<void>;
  get(workspaceId: string): WorkspaceLayoutEnvelope | null;
  applyPush(input: ApplyWorkspaceLayoutPushInput): ApplyWorkspaceLayoutPushResult;
  remove(workspaceId: string): Promise<void>;
  // Resolves once every queued write has flushed. For tests and graceful shutdown.
  flush(): Promise<void>;
}

// Per-workspace desktop tab layout, persisted as a JSON array of envelopes keyed by
// workspaceId. Mirrors the FileBackedRegistry cache + serialized persistQueue pattern,
// but `get`/`applyPush` are synchronous because they sit on the WebSocket broadcast hot
// path: `initialize()` must be awaited once at startup before the store serves reads.
export class FileBackedWorkspaceLayoutStore implements WorkspaceLayoutStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private readonly cache = new Map<string, WorkspaceLayoutEnvelope>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "workspace-layout-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.cache.clear();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = z.array(WorkspaceLayoutEnvelopeSchema).parse(JSON.parse(raw));
      for (const envelope of parsed) {
        this.cache.set(envelope.workspaceId, envelope);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load workspace layout store",
        );
      }
    }
    this.loaded = true;
  }

  get(workspaceId: string): WorkspaceLayoutEnvelope | null {
    return this.cache.get(workspaceId) ?? null;
  }

  applyPush(input: ApplyWorkspaceLayoutPushInput): ApplyWorkspaceLayoutPushResult {
    const stored = this.cache.get(input.workspaceId) ?? null;
    // Last-write-wins by monotonic revision. Reject a push that is not strictly newer
    // than what we hold so a stale client cannot clobber a peer's more recent layout.
    if (stored && input.revision <= stored.revision) {
      return { accepted: false, current: stored };
    }
    const current: WorkspaceLayoutEnvelope = {
      workspaceId: input.workspaceId,
      revision: input.revision,
      updatedAt: new Date().toISOString(),
      layout: input.layout,
    };
    this.cache.set(input.workspaceId, current);
    this.enqueuePersist();
    return { accepted: true, current };
  }

  async remove(workspaceId: string): Promise<void> {
    if (!this.cache.delete(workspaceId)) {
      return;
    }
    this.enqueuePersist();
    await this.persistQueue;
  }

  flush(): Promise<void> {
    return this.persistQueue;
  }

  private enqueuePersist(): void {
    this.persistQueue = this.persistQueue
      .then(() => writeJsonFileAtomic(this.filePath, Array.from(this.cache.values())))
      .catch((error) => {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to persist workspace layouts",
        );
      });
  }
}
