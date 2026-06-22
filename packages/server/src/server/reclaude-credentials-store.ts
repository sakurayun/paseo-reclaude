import { promises as fs } from "node:fs";

import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

// Persisted shape: just the reclaude.ai session cookie plus the email it belongs
// to (shown back to the user as "signed in as"). The password is NEVER stored —
// it is used once to mint the cookie and then discarded. See
// docs/reclaude-integration.md.
const ReclaudeCredentialsFileSchema = z.object({
  cookie: z.string(),
  email: z.string(),
  savedAt: z.string(),
});

export type ReclaudeCredentials = z.infer<typeof ReclaudeCredentialsFileSchema>;

export interface ReclaudeCredentialsStore {
  initialize(): Promise<void>;
  get(): ReclaudeCredentials | null;
  set(input: { cookie: string; email: string }): Promise<void>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

// File-backed store for the reclaude.ai session cookie. Written with 0o600 perms
// via writeJsonFileAtomic (atomic temp-file + rename). Modeled on
// FileBackedAppearanceSettingsStore.
export class FileBackedReclaudeCredentialsStore implements ReclaudeCredentialsStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private credentials: ReclaudeCredentials | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "reclaude-credentials-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.credentials = ReclaudeCredentialsFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load reclaude credentials",
        );
      }
    }
    this.loaded = true;
  }

  get(): ReclaudeCredentials | null {
    return this.credentials;
  }

  async set(input: { cookie: string; email: string }): Promise<void> {
    this.credentials = {
      cookie: input.cookie,
      email: input.email,
      savedAt: new Date().toISOString(),
    };
    this.enqueuePersist();
    await this.persistQueue;
  }

  async clear(): Promise<void> {
    this.credentials = null;
    this.persistQueue = this.persistQueue
      .then(() => fs.rm(this.filePath, { force: true }))
      .catch((error) => {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to clear reclaude credentials",
        );
      });
    await this.persistQueue;
  }

  flush(): Promise<void> {
    return this.persistQueue;
  }

  private enqueuePersist(): void {
    const snapshot = this.credentials;
    this.persistQueue = this.persistQueue
      .then(() => {
        if (snapshot) {
          return writeJsonFileAtomic(this.filePath, snapshot);
        }
        return undefined;
      })
      .catch((error) => {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to persist reclaude credentials",
        );
      });
  }
}
