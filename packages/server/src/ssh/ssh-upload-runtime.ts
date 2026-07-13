import type { FileTransferFrame } from "@getpaseo/protocol/binary-frames/index";
import { FileTransferOpcode } from "@getpaseo/protocol/binary-frames/index";
import type { SshUpload, SshUploadFile, SshUploadsProgress } from "@getpaseo/protocol/messages";
import { parseSshUploadFrameId } from "@getpaseo/protocol/ssh-upload";

import { HostKeyMismatchError } from "./ssh-connection-pool.js";
import { sshHostNeedsFallback } from "./ssh-fallback.js";
import type { SshHostInfo } from "@getpaseo/protocol/messages";

// Structural subset of ssh2's SFTPWrapper / WriteStream so the runtime can be
// unit-tested against fakes; the real wrapper satisfies these shapes.
export interface SshUploadSftpStream {
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean;
  end(callback?: () => void): void;
  destroy(): void;
}

export interface SshUploadSftp {
  realpath(path: string, callback: (err: Error | null | undefined, absPath: string) => void): void;
  mkdir(path: string, callback: (err?: Error | null) => void): void;
  unlink(path: string, callback: (err?: Error | null) => void): void;
  createWriteStream(path: string): SshUploadSftpStream;
}

export interface SshUploadPoolConnection {
  sftp(): Promise<SshUploadSftp>;
}

export interface SshUploadAcquired {
  connection: SshUploadPoolConnection;
  release: () => void;
}

export interface SshUploadRuntimeDeps {
  pool: { acquire(hostId: string): Promise<SshUploadAcquired> };
  hostStore: { getHost(id: string): SshHostInfo | undefined };
}

export interface SshUploadEnqueueInput {
  uploadId: string;
  hostId: string;
  terminalId?: string;
  destDir: string;
  files: Array<{ id: string; relativePath: string; size: number }>;
}

export type SshUploadEnqueueResult =
  | { ok: true; upload: SshUpload }
  | {
      ok: false;
      error: string;
      code?: "sftp_unavailable" | "host_not_found" | "host_key_mismatch";
    };

export interface SshUploadRuntime {
  enqueue(input: SshUploadEnqueueInput): Promise<SshUploadEnqueueResult>;
  receiveFrame(frame: FileTransferFrame): void;
  cancel(input: { uploadId: string; fileIds?: string[] }): { ok: boolean; error?: string };
  clear(input: { uploadIds?: string[] }): void;
  list(): SshUpload[];
  subscribeChanged(listener: (uploads: SshUpload[]) => void): () => void;
  subscribeProgress(listener: (payload: SshUploadsProgress["payload"]) => void): () => void;
  dispose(): void;
}

const MAX_FILES_PER_UPLOAD = 5000;
const MAX_RELATIVE_PATH_LENGTH = 1024;
const PROGRESS_EMIT_INTERVAL_MS = 150;
// An active upload with no client frames for this long is presumed orphaned
// (client crashed or disconnected mid-stream) and fails its remaining files.
const STALE_UPLOAD_TIMEOUT_MS = 120_000;
const STALE_SWEEP_INTERVAL_MS = 30_000;

interface UploadFileState {
  info: SshUploadFile;
  bytesReceived: number;
  stream: SshUploadSftpStream | null;
  remotePath: string | null;
  // Serializes begin/chunk/end operations for this file; every continuation
  // handles its own errors so the chain never rejects unhandled.
  chain: Promise<void>;
}

interface UploadTask {
  upload: SshUpload;
  files: Map<string, UploadFileState>;
  acquired: SshUploadAcquired | null;
  sftp: SshUploadSftp | null;
  resolvedDestDir: string;
  createdDirs: Set<string>;
  lastFrameAt: number;
  dirtyProgress: Set<string>;
}

// Joins POSIX remote path segments without importing node:path (remote paths
// are always slash-separated regardless of daemon platform).
function joinRemote(base: string, relative: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return relative ? `${trimmedBase}/${relative}` : trimmedBase;
}

function remoteDirname(remotePath: string): string {
  const index = remotePath.lastIndexOf("/");
  return index <= 0 ? "/" : remotePath.slice(0, index);
}

// Rejects traversal and other path shapes that could escape destDir. Dropped
// entries always use "/" separators (webkitGetAsEntry semantics).
function sanitizeRelativePath(relativePath: string): string | null {
  if (!relativePath || relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    return null;
  }
  const normalized = relativePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\\") || normalized.includes("\0")) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return normalized;
}

export function createSshUploadRuntime(deps: SshUploadRuntimeDeps): SshUploadRuntime {
  const tasks = new Map<string, UploadTask>();
  const changedListeners = new Set<(uploads: SshUpload[]) => void>();
  const progressListeners = new Set<(payload: SshUploadsProgress["payload"]) => void>();
  let progressTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  const staleTimer = setInterval(() => {
    const now = Date.now();
    for (const task of tasks.values()) {
      if (task.upload.status === "active" && now - task.lastFrameAt > STALE_UPLOAD_TIMEOUT_MS) {
        failRemainingFiles(task, "Upload interrupted: no data received from the client");
      }
    }
  }, STALE_SWEEP_INTERVAL_MS);
  staleTimer.unref?.();

  function snapshotUploads(): SshUpload[] {
    return Array.from(tasks.values(), (task) => structuredClone(task.upload));
  }

  function emitChanged(): void {
    const uploads = snapshotUploads();
    for (const listener of changedListeners) {
      listener(uploads);
    }
  }

  function markProgress(task: UploadTask, fileId: string): void {
    task.dirtyProgress.add(fileId);
    if (progressTimer) {
      return;
    }
    progressTimer = setTimeout(() => {
      progressTimer = null;
      flushProgress();
    }, PROGRESS_EMIT_INTERVAL_MS);
    progressTimer.unref?.();
  }

  function flushProgress(): void {
    for (const task of tasks.values()) {
      if (task.dirtyProgress.size === 0) {
        continue;
      }
      const files = Array.from(task.dirtyProgress, (fileId) => {
        const state = task.files.get(fileId);
        return state
          ? {
              id: fileId,
              bytesReceived: state.bytesReceived,
              bytesWritten: state.info.bytesWritten,
            }
          : null;
      }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      task.dirtyProgress.clear();
      if (files.length === 0) {
        continue;
      }
      const payload = { uploadId: task.upload.uploadId, files };
      for (const listener of progressListeners) {
        listener(payload);
      }
    }
  }

  // Recomputes the aggregate status; on the transition out of "active" the
  // task lets go of its SFTP channel and pooled connection.
  function refreshUploadStatus(task: UploadTask): void {
    const files = task.upload.files;
    const active = files.some((file) => file.status === "pending" || file.status === "uploading");
    let status: SshUpload["status"];
    if (active) {
      status = "active";
    } else if (files.some((file) => file.status === "error")) {
      status = "error";
    } else if (files.some((file) => file.status === "canceled")) {
      status = "canceled";
    } else {
      status = "done";
    }
    const changed = task.upload.status !== status;
    task.upload.status = status;
    if (status !== "active") {
      releaseTaskResources(task);
    }
    if (changed) {
      emitChanged();
    }
  }

  function releaseTaskResources(task: UploadTask): void {
    task.sftp = null;
    if (task.acquired) {
      const { release } = task.acquired;
      task.acquired = null;
      try {
        release();
      } catch {
        // The pooled connection may already be closed.
      }
    }
  }

  function failFile(task: UploadTask, state: UploadFileState, message: string): void {
    if (state.info.status !== "pending" && state.info.status !== "uploading") {
      return;
    }
    state.info.status = "error";
    state.info.error = message;
    destroyStream(state);
    refreshUploadStatus(task);
    emitChanged();
  }

  function failRemainingFiles(task: UploadTask, message: string): void {
    for (const state of task.files.values()) {
      if (state.info.status === "pending" || state.info.status === "uploading") {
        state.info.status = "error";
        state.info.error = message;
        destroyStream(state);
      }
    }
    refreshUploadStatus(task);
    emitChanged();
  }

  function destroyStream(state: UploadFileState): void {
    const stream = state.stream;
    state.stream = null;
    if (stream) {
      try {
        stream.destroy();
      } catch {
        // Channel may already be gone.
      }
    }
  }

  function realpath(sftp: SshUploadSftp, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      sftp.realpath(path, (error, absPath) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(absPath);
      });
    });
  }

  async function resolveDestDir(sftp: SshUploadSftp, destDir: string): Promise<string> {
    const trimmed = destDir.trim() || "~";
    if (trimmed === "~") {
      return realpath(sftp, ".");
    }
    if (trimmed.startsWith("~/")) {
      return joinRemote(await realpath(sftp, "."), trimmed.slice(2));
    }
    if (!trimmed.startsWith("/")) {
      return joinRemote(await realpath(sftp, "."), trimmed);
    }
    return trimmed;
  }

  // mkdir -p: attempts each ancestor below root; "already exists" errors are
  // indistinguishable from other failures over SFTP, so all mkdir errors are
  // ignored — a truly missing directory surfaces on the file write instead.
  async function ensureRemoteDir(task: UploadTask, dir: string): Promise<void> {
    const sftp = task.sftp;
    if (!sftp || task.createdDirs.has(dir) || dir === "/" || dir === "") {
      return;
    }
    const segments = dir.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      if (task.createdDirs.has(current)) {
        continue;
      }
      await new Promise<void>((resolve) => {
        sftp.mkdir(current, () => resolve());
      });
      task.createdDirs.add(current);
    }
  }

  function writeToStream(stream: SshUploadSftpStream, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      // The callback fires once the chunk is flushed to the SFTP layer, so
      // awaiting it both serializes writes and applies backpressure.
      stream.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  function endStream(stream: SshUploadSftpStream): Promise<void> {
    return new Promise((resolve) => {
      stream.end(() => resolve());
    });
  }

  // Appends an operation to the file's serial chain. Continuations handle
  // their own errors, so the stored promise never rejects unhandled.
  function chainFileOp(state: UploadFileState, op: () => Promise<void> | void): void {
    const previous = state.chain;
    state.chain = (async () => {
      await previous;
      await op();
    })();
  }

  function handleFileBegin(task: UploadTask, state: UploadFileState): void {
    chainFileOp(state, async () => {
      if (state.info.status !== "pending") {
        return;
      }
      try {
        const remotePath = joinRemote(task.resolvedDestDir, state.info.relativePath);
        await ensureRemoteDir(task, remoteDirname(remotePath));
        const sftp = task.sftp;
        if (!sftp || state.info.status !== "pending") {
          return;
        }
        state.remotePath = remotePath;
        state.stream = sftp.createWriteStream(remotePath);
        state.info.status = "uploading";
        refreshUploadStatus(task);
        emitChanged();
      } catch (error) {
        failFile(task, state, error instanceof Error ? error.message : String(error));
      }
    });
  }

  function handleFileChunk(task: UploadTask, state: UploadFileState, payload: Uint8Array): void {
    // Copy out of the WebSocket frame buffer: the chunk is written after an
    // async hop and the transport may reuse the underlying ArrayBuffer.
    const chunk = payload.slice();
    state.bytesReceived += chunk.byteLength;
    if (state.bytesReceived > state.info.size) {
      chainFileOp(state, () => {
        failFile(task, state, "Received more bytes than the declared file size");
      });
      return;
    }
    markProgress(task, state.info.id);
    chainFileOp(state, async () => {
      const stream = state.stream;
      if (!stream || state.info.status !== "uploading") {
        return;
      }
      try {
        await writeToStream(stream, chunk);
        state.info.bytesWritten += chunk.byteLength;
        markProgress(task, state.info.id);
      } catch (error) {
        failFile(task, state, error instanceof Error ? error.message : String(error));
      }
    });
  }

  function handleFileEnd(task: UploadTask, state: UploadFileState): void {
    chainFileOp(state, async () => {
      if (state.info.status !== "uploading") {
        return;
      }
      const stream = state.stream;
      state.stream = null;
      if (stream) {
        await endStream(stream);
      }
      if (state.info.bytesWritten !== state.info.size) {
        state.info.status = "error";
        state.info.error = "Transfer ended before all bytes arrived";
      } else {
        state.info.status = "done";
      }
      markProgress(task, state.info.id);
      refreshUploadStatus(task);
      emitChanged();
    });
  }

  return {
    async enqueue(input: SshUploadEnqueueInput): Promise<SshUploadEnqueueResult> {
      if (disposed) {
        return { ok: false, error: "SSH upload runtime is shut down" };
      }
      if (tasks.has(input.uploadId)) {
        return { ok: false, error: "Duplicate upload id" };
      }
      if (input.files.length === 0) {
        return { ok: false, error: "Upload contains no files" };
      }
      if (input.files.length > MAX_FILES_PER_UPLOAD) {
        return { ok: false, error: `Too many files (limit ${MAX_FILES_PER_UPLOAD})` };
      }
      const host = deps.hostStore.getHost(input.hostId);
      if (!host) {
        return { ok: false, error: "SSH host not found", code: "host_not_found" };
      }
      if (sshHostNeedsFallback(host)) {
        return {
          ok: false,
          error:
            "This host connects through the system ssh/mosh binary; SFTP upload is unavailable",
          code: "sftp_unavailable",
        };
      }

      const seenIds = new Set<string>();
      const sanitizedFiles: Array<{ id: string; relativePath: string; size: number }> = [];
      for (const file of input.files) {
        const relativePath = sanitizeRelativePath(file.relativePath);
        if (!relativePath) {
          return { ok: false, error: `Invalid file path: ${file.relativePath}` };
        }
        if (seenIds.has(file.id)) {
          return { ok: false, error: "Duplicate file id in upload" };
        }
        seenIds.add(file.id);
        sanitizedFiles.push({ id: file.id, relativePath, size: file.size });
      }

      let acquired: SshUploadAcquired;
      try {
        acquired = await deps.pool.acquire(input.hostId);
      } catch (error) {
        if (error instanceof HostKeyMismatchError) {
          return { ok: false, error: error.message, code: "host_key_mismatch" };
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

      let sftp: SshUploadSftp;
      let resolvedDestDir: string;
      try {
        sftp = await acquired.connection.sftp();
        resolvedDestDir = await resolveDestDir(sftp, input.destDir);
      } catch (error) {
        acquired.release();
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

      const files = new Map<string, UploadFileState>();
      const wireFiles: SshUploadFile[] = [];
      for (const file of sanitizedFiles) {
        const info: SshUploadFile = {
          id: file.id,
          relativePath: file.relativePath,
          size: file.size,
          status: "pending",
          bytesWritten: 0,
          error: null,
        };
        wireFiles.push(info);
        files.set(file.id, {
          info,
          bytesReceived: 0,
          stream: null,
          remotePath: null,
          chain: Promise.resolve(),
        });
      }

      const upload: SshUpload = {
        uploadId: input.uploadId,
        hostId: input.hostId,
        hostLabel: host.label,
        ...(input.terminalId !== undefined ? { terminalId: input.terminalId } : {}),
        destDir: input.destDir.trim() || "~",
        status: "active",
        files: wireFiles,
        startedAt: Date.now(),
        error: null,
      };

      tasks.set(input.uploadId, {
        upload,
        files,
        acquired,
        sftp,
        resolvedDestDir,
        createdDirs: new Set(),
        lastFrameAt: Date.now(),
        dirtyProgress: new Set(),
      });
      emitChanged();
      return { ok: true, upload: structuredClone(upload) };
    },

    receiveFrame(frame: FileTransferFrame): void {
      const parsed = parseSshUploadFrameId(frame.requestId);
      if (!parsed) {
        return;
      }
      const task = tasks.get(parsed.uploadId);
      const state = task?.files.get(parsed.fileId);
      if (!task || !state) {
        return;
      }
      task.lastFrameAt = Date.now();
      switch (frame.opcode) {
        case FileTransferOpcode.FileBegin:
          handleFileBegin(task, state);
          return;
        case FileTransferOpcode.FileChunk:
          handleFileChunk(task, state, frame.payload);
          return;
        case FileTransferOpcode.FileEnd:
          handleFileEnd(task, state);
          return;
      }
    },

    cancel(input: { uploadId: string; fileIds?: string[] }): { ok: boolean; error?: string } {
      const task = tasks.get(input.uploadId);
      if (!task) {
        return { ok: false, error: "Upload not found" };
      }
      const targets = input.fileIds
        ? input.fileIds
            .map((fileId) => task.files.get(fileId))
            .filter((state): state is UploadFileState => state !== undefined)
        : Array.from(task.files.values());
      const sftp = task.sftp;
      for (const state of targets) {
        if (state.info.status !== "pending" && state.info.status !== "uploading") {
          continue;
        }
        const hadStream = state.stream !== null;
        state.info.status = "canceled";
        destroyStream(state);
        // Best-effort cleanup of the partial remote file.
        if (hadStream && sftp && state.remotePath) {
          const remotePath = state.remotePath;
          chainFileOp(
            state,
            () =>
              new Promise<void>((resolve) => {
                sftp.unlink(remotePath, () => resolve());
              }),
          );
        }
      }
      refreshUploadStatus(task);
      emitChanged();
      return { ok: true };
    },

    clear(input: { uploadIds?: string[] }): void {
      const ids = input.uploadIds ?? Array.from(tasks.keys());
      let removed = false;
      for (const uploadId of ids) {
        const task = tasks.get(uploadId);
        if (task && task.upload.status !== "active") {
          tasks.delete(uploadId);
          removed = true;
        }
      }
      if (removed) {
        emitChanged();
      }
    },

    list(): SshUpload[] {
      return snapshotUploads();
    },

    subscribeChanged(listener: (uploads: SshUpload[]) => void): () => void {
      changedListeners.add(listener);
      return () => {
        changedListeners.delete(listener);
      };
    },

    subscribeProgress(listener: (payload: SshUploadsProgress["payload"]) => void): () => void {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
      };
    },

    dispose(): void {
      disposed = true;
      clearInterval(staleTimer);
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      for (const task of tasks.values()) {
        for (const state of task.files.values()) {
          destroyStream(state);
        }
        releaseTaskResources(task);
      }
      tasks.clear();
      changedListeners.clear();
      progressListeners.clear();
    },
  };
}
