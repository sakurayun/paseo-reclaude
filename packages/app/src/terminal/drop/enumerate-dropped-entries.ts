// Directory-aware enumeration of drag-dropped items (web/Electron only).
// `collectDroppedItems` must run synchronously inside the drop event —
// DataTransferItems are neutered once the handler returns — while the
// directory walk (`enumerateDroppedItems`) is async.

export interface DroppedItemHandle {
  file: File | null;
  entry: FileSystemEntry | null;
}

// Payload handed to TerminalEmulator's onFileDrop: the pre-escaped local paths
// (Electron only; null on pure web) plus the raw handles for SFTP upload.
export interface TerminalEmulatorFileDrop {
  pasteText: string | null;
  items: DroppedItemHandle[];
}

export interface EnumeratedDropFile {
  file: File;
  // POSIX-style path relative to the drop root, including the dropped
  // directory's own name ("photos/2024/a.jpg").
  relativePath: string;
}

export interface EnumeratedDrop {
  files: EnumeratedDropFile[];
  totalSize: number;
  // True when enumeration stopped at the file cap.
  truncated: boolean;
}

export const MAX_DROPPED_FILES = 2000;

export function collectDroppedItems(dataTransfer: DataTransfer | null): DroppedItemHandle[] {
  if (!dataTransfer) {
    return [];
  }
  const handles: DroppedItemHandle[] = [];
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    for (const item of Array.from(items)) {
      if (item.kind !== "file") {
        continue;
      }
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      const file = item.getAsFile();
      if (entry || file) {
        handles.push({ file, entry });
      }
    }
    if (handles.length > 0) {
      return handles;
    }
  }
  return Array.from(dataTransfer.files ?? []).map((file) => ({ file, entry: null }));
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

// readEntries only returns a batch at a time (Chromium caps it at 100);
// drain until an empty batch marks the end of the directory.
async function readAllDirectoryEntries(
  directory: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

function entryRelativePath(entry: FileSystemEntry): string {
  const stripped = (entry.fullPath ?? "").replace(/^\/+/, "");
  return stripped || entry.name;
}

export async function enumerateDroppedItems(
  handles: readonly DroppedItemHandle[],
): Promise<EnumeratedDrop> {
  const files: EnumeratedDropFile[] = [];
  let truncated = false;

  async function visit(entry: FileSystemEntry): Promise<void> {
    if (files.length >= MAX_DROPPED_FILES) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      try {
        const file = await entryToFile(entry as FileSystemFileEntry);
        files.push({ file, relativePath: entryRelativePath(entry) });
      } catch {
        // Unreadable entries (permissions, vanished files) are skipped.
      }
      return;
    }
    if (entry.isDirectory) {
      const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry);
      for (const child of children) {
        if (files.length >= MAX_DROPPED_FILES) {
          truncated = true;
          return;
        }
        await visit(child);
      }
    }
  }

  for (const handle of handles) {
    if (handle.entry) {
      await visit(handle.entry);
    } else if (handle.file) {
      if (files.length >= MAX_DROPPED_FILES) {
        truncated = true;
        break;
      }
      files.push({ file: handle.file, relativePath: handle.file.name });
    }
  }

  const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);
  return { files, totalSize, truncated };
}
