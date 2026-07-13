import { describe, expect, it, vi } from "vitest";
import { FileTransferOpcode } from "@getpaseo/protocol/binary-frames/index";
import type { SshHostInfo } from "@getpaseo/protocol/messages";
import { buildSshUploadFrameId } from "@getpaseo/protocol/ssh-upload";

import {
  createSshUploadRuntime,
  type SshUploadSftp,
  type SshUploadSftpStream,
} from "./ssh-upload-runtime.js";

interface FakeRemote {
  sftp: SshUploadSftp;
  writes: Map<string, Uint8Array[]>;
  mkdirs: string[];
  unlinks: string[];
}

function createFakeRemote(options: { failWrites?: boolean } = {}): FakeRemote {
  const writes = new Map<string, Uint8Array[]>();
  const mkdirs: string[] = [];
  const unlinks: string[] = [];
  const sftp: SshUploadSftp = {
    realpath(_path, callback) {
      queueMicrotask(() => callback(null, "/home/user"));
    },
    mkdir(path, callback) {
      mkdirs.push(path);
      queueMicrotask(() => callback(null));
    },
    unlink(path, callback) {
      unlinks.push(path);
      queueMicrotask(() => callback(null));
    },
    createWriteStream(path): SshUploadSftpStream {
      writes.set(path, []);
      return {
        write(chunk, callback) {
          if (options.failWrites) {
            queueMicrotask(() => callback(new Error("write failed")));
            return true;
          }
          writes.get(path)?.push(chunk.slice());
          queueMicrotask(() => callback(null));
          return true;
        },
        end(callback) {
          queueMicrotask(() => callback?.());
        },
        destroy() {},
      };
    },
  };
  return { sftp, writes, mkdirs, unlinks };
}

function createHost(overrides: Partial<SshHostInfo> = {}): SshHostInfo {
  return { id: "host-1", label: "Test host", address: "example.com", ...overrides };
}

function createRuntime(input: { remote?: FakeRemote; host?: SshHostInfo | undefined } = {}) {
  const remote = input.remote ?? createFakeRemote();
  const release = vi.fn();
  const host = "host" in input ? input.host : createHost();
  const runtime = createSshUploadRuntime({
    pool: {
      acquire: vi.fn(async () => ({
        connection: { sftp: async () => remote.sftp },
        release,
      })),
    },
    hostStore: { getHost: (id) => (host && host.id === id ? host : undefined) },
  });
  return { runtime, remote, release };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ssh upload runtime", () => {
  it("uploads a streamed file to the resolved home-relative destination", async () => {
    const { runtime, remote, release } = createRuntime();
    const result = await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "~/incoming",
      files: [{ id: "f1", relativePath: "dir/data.bin", size: 6 }],
    });
    expect(result.ok).toBe(true);

    const frameId = buildSshUploadFrameId("u1", "f1");
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: frameId,
      metadata: { mime: "application/octet-stream", size: 6, encoding: "binary", modifiedAt: "" },
      payload: new Uint8Array(),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: frameId,
      payload: new Uint8Array([1, 2, 3]),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: frameId,
      payload: new Uint8Array([4, 5, 6]),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileEnd,
      requestId: frameId,
      payload: new Uint8Array(),
    });

    await waitFor(() => runtime.list()[0]?.status === "done");
    const upload = runtime.list()[0];
    expect(upload?.files[0]).toMatchObject({ status: "done", bytesWritten: 6 });
    const written = remote.writes.get("/home/user/incoming/dir/data.bin");
    expect(written).toBeDefined();
    expect(Buffer.concat(written ?? [])).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
    expect(remote.mkdirs).toContain("/home/user/incoming/dir");
    expect(release).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("rejects hosts that require the ssh/mosh fallback", async () => {
    const { runtime } = createRuntime({
      host: createHost({ mosh: { enabled: true } as SshHostInfo["mosh"] }),
    });
    const result = await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "~",
      files: [{ id: "f1", relativePath: "a.txt", size: 1 }],
    });
    expect(result).toMatchObject({ ok: false, code: "sftp_unavailable" });
    runtime.dispose();
  });

  it("rejects traversal in relative paths", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "~",
      files: [{ id: "f1", relativePath: "../escape.txt", size: 1 }],
    });
    expect(result.ok).toBe(false);
    runtime.dispose();
  });

  it("cancels an in-flight file, unlinks the partial upload, and releases the connection", async () => {
    const { runtime, remote, release } = createRuntime();
    await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "/data",
      files: [{ id: "f1", relativePath: "big.bin", size: 100 }],
    });
    const frameId = buildSshUploadFrameId("u1", "f1");
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: frameId,
      metadata: { mime: "application/octet-stream", size: 100, encoding: "binary", modifiedAt: "" },
      payload: new Uint8Array(),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: frameId,
      payload: new Uint8Array([9, 9]),
    });
    await waitFor(() => runtime.list()[0]?.files[0]?.status === "uploading");

    expect(runtime.cancel({ uploadId: "u1", fileIds: ["f1"] })).toEqual({ ok: true });
    await waitFor(() => runtime.list()[0]?.status === "canceled");
    expect(runtime.list()[0]?.files[0]?.status).toBe("canceled");
    await waitFor(() => remote.unlinks.includes("/data/big.bin"));
    expect(release).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("broadcasts changed snapshots and throttled progress", async () => {
    const { runtime } = createRuntime();
    const changed = vi.fn();
    const progress = vi.fn();
    runtime.subscribeChanged(changed);
    runtime.subscribeProgress(progress);

    await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "~",
      files: [{ id: "f1", relativePath: "a.txt", size: 2 }],
    });
    expect(changed).toHaveBeenCalled();

    const frameId = buildSshUploadFrameId("u1", "f1");
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: frameId,
      metadata: { mime: "text/plain", size: 2, encoding: "binary", modifiedAt: "" },
      payload: new Uint8Array(),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: frameId,
      payload: new Uint8Array([1, 2]),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileEnd,
      requestId: frameId,
      payload: new Uint8Array(),
    });

    await waitFor(() => progress.mock.calls.length > 0);
    const payload = progress.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ uploadId: "u1" });
    expect(payload.files[0]).toMatchObject({ id: "f1" });
    runtime.dispose();
  });

  it("ignores frames for unknown uploads", () => {
    const { runtime } = createRuntime();
    expect(() =>
      runtime.receiveFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: buildSshUploadFrameId("nope", "nada"),
        payload: new Uint8Array([1]),
      }),
    ).not.toThrow();
    runtime.dispose();
  });

  it("fails a file whose write errors and settles the upload as error", async () => {
    const remote = createFakeRemote({ failWrites: true });
    const { runtime } = createRuntime({ remote });
    await runtime.enqueue({
      uploadId: "u1",
      hostId: "host-1",
      destDir: "~",
      files: [{ id: "f1", relativePath: "a.txt", size: 2 }],
    });
    const frameId = buildSshUploadFrameId("u1", "f1");
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: frameId,
      metadata: { mime: "text/plain", size: 2, encoding: "binary", modifiedAt: "" },
      payload: new Uint8Array(),
    });
    runtime.receiveFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: frameId,
      payload: new Uint8Array([1, 2]),
    });
    await waitFor(() => runtime.list()[0]?.status === "error");
    expect(runtime.list()[0]?.files[0]).toMatchObject({ status: "error", error: "write failed" });
    runtime.dispose();
  });
});
