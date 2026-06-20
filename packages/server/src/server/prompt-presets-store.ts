import { promises as fs } from "node:fs";

import type { PromptPresetsEnvelope } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

const PromptPresetsEnvelopeFileSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  presets: z.array(z.string()),
});

export interface ApplyPromptPresetsPushInput {
  revision: number;
  presets: string[];
}

export interface ApplyPromptPresetsPushResult {
  accepted: boolean;
  current: PromptPresetsEnvelope;
}

export interface PromptPresetsStore {
  initialize(): Promise<void>;
  get(): PromptPresetsEnvelope;
  applyPush(input: ApplyPromptPresetsPushInput): ApplyPromptPresetsPushResult;
  flush(): Promise<void>;
}

function normalizePresets(presets: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const preset of presets) {
    const value = preset.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export class FileBackedPromptPresetsStore implements PromptPresetsStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private envelope: PromptPresetsEnvelope = {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    presets: [],
  };
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "prompt-presets-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = PromptPresetsEnvelopeFileSchema.parse(JSON.parse(raw));
      this.envelope = {
        ...parsed,
        presets: normalizePresets(parsed.presets),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error({ err: error, filePath: this.filePath }, "Failed to load prompt presets");
      }
    }
    this.loaded = true;
  }

  get(): PromptPresetsEnvelope {
    return this.envelope;
  }

  applyPush(input: ApplyPromptPresetsPushInput): ApplyPromptPresetsPushResult {
    if (input.revision <= this.envelope.revision) {
      return { accepted: false, current: this.envelope };
    }
    this.envelope = {
      revision: input.revision,
      updatedAt: new Date().toISOString(),
      presets: normalizePresets(input.presets),
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
          "Failed to persist prompt presets",
        );
      });
  }
}
