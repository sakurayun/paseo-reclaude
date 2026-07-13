import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SshUploadFile } from "@getpaseo/protocol/messages";
import { buildSshUploadFrameId } from "@getpaseo/protocol/ssh-upload";
import type { EnumeratedDropFile } from "@/terminal/drop/enumerate-dropped-entries";
import { getSshUpload, useSshUploadStore } from "@/stores/ssh-upload-store";

// Streams dropped files to the daemon's SFTP upload runtime. Files go out
// sequentially over the shared binary channel; a windowed sender keeps at most
// MAX_UNACKED_BYTES in flight, acked by the daemon's ssh.uploads.progress
// bytesReceived counters (essential over the relay, which has no transport
// backpressure).

const CHUNK_SIZE = 512 * 1024;
const MAX_UNACKED_BYTES = 8 * 1024 * 1024;
const WINDOW_POLL_INTERVAL_MS = 100;

export interface StartSshUploadInput {
  client: DaemonClient;
  serverId: string;
  hostId: string;
  terminalId: string;
  destDir: string;
  files: EnumeratedDropFile[];
}

export type StartSshUploadResult =
  | { ok: true; uploadId: string }
  | {
      ok: false;
      error: string;
      code?: "sftp_unavailable" | "host_not_found" | "host_key_mismatch";
    };

function createTransferId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileState(serverId: string, uploadId: string, fileId: string): SshUploadFile | null {
  const upload = getSshUpload(serverId, uploadId);
  return upload?.files.find((file) => file.id === fileId) ?? null;
}

function uploadTerminated(serverId: string, uploadId: string): boolean {
  const upload = getSshUpload(serverId, uploadId);
  return upload !== null && upload.status !== "active";
}

function fileTerminated(serverId: string, uploadId: string, fileId: string): boolean {
  const status = fileState(serverId, uploadId, fileId)?.status;
  return status === "canceled" || status === "error" || status === "done";
}

function ackedBytes(serverId: string, uploadId: string, fileId: string): number {
  const state = useSshUploadStore.getState();
  const progress = state.progressByUpload[uploadId]?.[fileId];
  if (progress) {
    return progress.bytesReceived;
  }
  return fileState(serverId, uploadId, fileId)?.bytesWritten ?? 0;
}

export async function startSshUpload(input: StartSshUploadInput): Promise<StartSshUploadResult> {
  const uploadId = createTransferId();
  const entries = input.files.map((item) => ({
    id: createTransferId(),
    relativePath: item.relativePath,
    size: item.file.size,
    file: item.file,
  }));

  const response = await input.client.enqueueSshUpload({
    uploadId,
    hostId: input.hostId,
    terminalId: input.terminalId,
    destDir: input.destDir,
    files: entries.map(({ id, relativePath, size }) => ({ id, relativePath, size })),
  });
  if (!response.upload) {
    return {
      ok: false,
      error: response.error ?? "Upload failed",
      ...(response.code !== undefined ? { code: response.code } : {}),
    };
  }

  // Seed the mirror immediately so the panel can render before the daemon's
  // ssh.uploads.changed broadcast lands.
  useSshUploadStore.getState().upsertUpload(input.serverId, response.upload);
  void streamUploadFiles(input, uploadId, entries);
  return { ok: true, uploadId };
}

async function streamUploadFiles(
  input: StartSshUploadInput,
  uploadId: string,
  entries: Array<{ id: string; relativePath: string; size: number; file: File }>,
): Promise<void> {
  for (const entry of entries) {
    if (uploadTerminated(input.serverId, uploadId)) {
      return;
    }
    if (fileTerminated(input.serverId, uploadId, entry.id)) {
      continue;
    }
    try {
      await streamSingleFile(input, uploadId, entry);
    } catch {
      // Local read failure (file moved/permission): settle the daemon-side
      // state so the panel doesn't show a forever-pending file.
      void input.client.cancelSshUpload({ uploadId, fileIds: [entry.id] }).catch(() => undefined);
    }
  }
}

function transferAborted(input: StartSshUploadInput, uploadId: string, fileId: string): boolean {
  return (
    uploadTerminated(input.serverId, uploadId) || fileTerminated(input.serverId, uploadId, fileId)
  );
}

// Blocks until the send window has room for the next chunk (or the transfer
// is canceled). Returns false when the transfer should stop.
async function waitForSendWindow(
  input: StartSshUploadInput,
  uploadId: string,
  fileId: string,
  wouldBeInFlight: () => number,
): Promise<boolean> {
  while (wouldBeInFlight() > MAX_UNACKED_BYTES) {
    if (transferAborted(input, uploadId, fileId)) {
      return false;
    }
    await sleep(WINDOW_POLL_INTERVAL_MS);
  }
  return !transferAborted(input, uploadId, fileId);
}

async function streamSingleFile(
  input: StartSshUploadInput,
  uploadId: string,
  entry: { id: string; size: number; file: File },
): Promise<void> {
  const frameId = buildSshUploadFrameId(uploadId, entry.id);
  input.client.sendSshUploadFileBegin({ frameId, size: entry.size });

  const reader = entry.file.stream().getReader();
  let sentBytes = 0;
  let aborted = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || aborted) {
        break;
      }
      for (let offset = 0; offset < value.byteLength && !aborted; offset += CHUNK_SIZE) {
        const chunk = value.subarray(offset, Math.min(offset + CHUNK_SIZE, value.byteLength));
        const windowOpen = await waitForSendWindow(
          input,
          uploadId,
          entry.id,
          () => sentBytes + chunk.byteLength - ackedBytes(input.serverId, uploadId, entry.id),
        );
        if (!windowOpen) {
          aborted = true;
          break;
        }
        input.client.sendSshUploadFileChunk(frameId, chunk);
        sentBytes += chunk.byteLength;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!aborted) {
    input.client.sendSshUploadFileEnd(frameId);
  }
}
