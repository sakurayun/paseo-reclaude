import { promises as fs } from "node:fs";

import type { AppearanceSettingsEnvelope } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

const AppearanceSettingsEnvelopeFileSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  settings: z.record(z.string(), z.unknown()),
});

export interface ApplyAppearanceSettingsPushInput {
  revision: number;
  settings: Record<string, unknown>;
}

export interface ApplyAppearanceSettingsPushResult {
  accepted: boolean;
  current: AppearanceSettingsEnvelope;
}

export interface AppearanceSettingsStore {
  initialize(): Promise<void>;
  get(): AppearanceSettingsEnvelope;
  applyPush(input: ApplyAppearanceSettingsPushInput): ApplyAppearanceSettingsPushResult;
  flush(): Promise<void>;
}

// File-backed store for the global appearance-settings blob. The daemon treats
// `settings` as opaque: it stores and forwards, never parses. Conflict resolution
// is last-write-wins by monotonic revision, matching the prompt-presets store.
export class FileBackedAppearanceSettingsStore implements AppearanceSettingsStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private envelope: AppearanceSettingsEnvelope = {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    settings: {},
  };
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "appearance-settings-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.envelope = AppearanceSettingsEnvelopeFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load appearance settings",
        );
      }
    }
    this.loaded = true;
  }

  get(): AppearanceSettingsEnvelope {
    return this.envelope;
  }

  applyPush(input: ApplyAppearanceSettingsPushInput): ApplyAppearanceSettingsPushResult {
    // Reject any push whose revision does not strictly advance the stored one.
    if (input.revision <= this.envelope.revision) {
      return { accepted: false, current: this.envelope };
    }
    this.envelope = {
      revision: input.revision,
      updatedAt: new Date().toISOString(),
      settings: input.settings,
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
          "Failed to persist appearance settings",
        );
      });
  }
}
