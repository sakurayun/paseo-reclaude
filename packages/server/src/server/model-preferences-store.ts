import { promises as fs } from "node:fs";

import type { ModelPreferencesEnvelope } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

const ModelPreferencesEnvelopeFileSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  preferences: z.record(z.string(), z.unknown()),
});

export interface ApplyModelPreferencesPushInput {
  revision: number;
  preferences: Record<string, unknown>;
}

export interface ApplyModelPreferencesPushResult {
  accepted: boolean;
  current: ModelPreferencesEnvelope;
}

export interface ModelPreferencesStore {
  initialize(): Promise<void>;
  get(): ModelPreferencesEnvelope;
  applyPush(input: ApplyModelPreferencesPushInput): ApplyModelPreferencesPushResult;
  flush(): Promise<void>;
}

// File-backed store for the global model-preferences blob (per-provider selection
// habits, favorite models, per-model thinking/feature settings). The daemon treats
// `preferences` as opaque: it stores and forwards, never parses. Conflict resolution
// is last-write-wins by monotonic revision, matching the appearance-settings store.
export class FileBackedModelPreferencesStore implements ModelPreferencesStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private envelope: ModelPreferencesEnvelope = {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    preferences: {},
  };
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "model-preferences-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.envelope = ModelPreferencesEnvelopeFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load model preferences",
        );
      }
    }
    this.loaded = true;
  }

  get(): ModelPreferencesEnvelope {
    return this.envelope;
  }

  applyPush(input: ApplyModelPreferencesPushInput): ApplyModelPreferencesPushResult {
    // Reject any push whose revision does not strictly advance the stored one.
    if (input.revision <= this.envelope.revision) {
      return { accepted: false, current: this.envelope };
    }
    this.envelope = {
      revision: input.revision,
      updatedAt: new Date().toISOString(),
      preferences: input.preferences,
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
          "Failed to persist model preferences",
        );
      });
  }
}
