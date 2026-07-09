import { promises as fs } from "node:fs";

import type { TerminalHistoryEntry } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "../server/atomic-file.js";
import type { TerminalClosedRecord } from "./terminal-manager.js";

const TerminalHistoryFileSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cwd: z.string(),
      workspaceId: z.string().optional(),
      title: z.string().optional(),
      exitCode: z.number().nullable().optional(),
      closedAt: z.number(),
    }),
  ),
});

const MAX_HISTORY_ENTRIES = 200;

export interface TerminalHistoryStore {
  initialize(): Promise<void>;
  append(record: TerminalClosedRecord): void;
  list(): TerminalHistoryEntry[];
  flush(): Promise<void>;
}

export class FileBackedTerminalHistoryStore implements TerminalHistoryStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private entries: TerminalHistoryEntry[] = [];
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "terminal-history-store" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = TerminalHistoryFileSchema.parse(JSON.parse(raw));
      this.entries = parsed.entries;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load terminal history",
        );
      }
    }
    this.loaded = true;
  }

  append(record: TerminalClosedRecord): void {
    const entry: TerminalHistoryEntry = {
      id: record.id,
      name: record.name,
      cwd: record.cwd,
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      ...(record.title ? { title: record.title } : {}),
      exitCode: record.exitCode,
      closedAt: record.closedAt,
    };
    // Newest first; re-closing the same terminal id replaces the older entry.
    this.entries = [entry, ...this.entries.filter((existing) => existing.id !== entry.id)].slice(
      0,
      MAX_HISTORY_ENTRIES,
    );
    this.enqueuePersist();
  }

  list(): TerminalHistoryEntry[] {
    return this.entries;
  }

  flush(): Promise<void> {
    return this.persistQueue;
  }

  private enqueuePersist(): void {
    this.persistQueue = this.persistQueue
      .then(() => writeJsonFileAtomic(this.filePath, { entries: this.entries }))
      .catch((error) => {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to persist terminal history",
        );
      });
  }
}
