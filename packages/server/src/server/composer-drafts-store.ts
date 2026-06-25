import { promises as fs } from "node:fs";

import type { ComposerDraftsEnvelope } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

const ComposerDraftsEnvelopeFileSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  drafts: z.record(z.string(), z.unknown()),
});

export interface ApplyComposerDraftsPushInput {
  revision: number;
  drafts: Record<string, unknown>;
}

export interface ApplyComposerDraftsPushResult {
  accepted: boolean;
  current: ComposerDraftsEnvelope;
}

export interface ComposerDraftsStore {
  initialize(): Promise<void>;
  get(): ComposerDraftsEnvelope;
  applyPush(input: ApplyComposerDraftsPushInput): ApplyComposerDraftsPushResult;
  flush(): Promise<void>;
}

// File-backed store for the global composer-drafts blob (per-session unsent composer
// drafts keyed by draftKey). The daemon treats `drafts` as opaque: it stores and
// forwards, never parses. Conflict resolution is last-write-wins by monotonic
// revision, matching the appearance-settings store.
export class FileBackedComposerDraftsStore implements ComposerDraftsStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private envelope: ComposerDraftsEnvelope = {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    drafts: {},
  };
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "composer-drafts-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.envelope = ComposerDraftsEnvelopeFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load composer drafts",
        );
      }
    }
    this.loaded = true;
  }

  get(): ComposerDraftsEnvelope {
    return this.envelope;
  }

  applyPush(input: ApplyComposerDraftsPushInput): ApplyComposerDraftsPushResult {
    // Reject any push whose revision does not strictly advance the stored one.
    if (input.revision <= this.envelope.revision) {
      return { accepted: false, current: this.envelope };
    }
    this.envelope = {
      revision: input.revision,
      updatedAt: new Date().toISOString(),
      drafts: input.drafts,
    };
    this.enqueuePersist();
    return { accepted: true, current: this.envelope };
  }

  flush(): Promise<void> {
    return this.persistQueue;
  }

  private enqueuePersist(): void {
    this.persistQueue = this.persistQueue
      .then(() => writeJsonFileAtomic(this.filePath, this.envelope))
      .catch((error) => {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to persist composer drafts",
        );
      });
  }
}
