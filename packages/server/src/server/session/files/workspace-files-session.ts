import type pino from "pino";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import type { FileVersion } from "@getpaseo/protocol/messages";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type {
  FileDownloadTokenRequest,
  FileExplorerCreateRequest,
  FileExplorerDeleteRequest,
  FileExplorerDuplicateRequest,
  FileExplorerRenameRequest,
  FileEntryCreateRequest,
  FileEntryDeleteRequest,
  FileEntryDuplicateRequest,
  FileEntryRenameRequest,
  FileExplorerRequest,
  FileUploadRequest,
  FileSubscribeRequest,
  FileUnsubscribeRequest,
  FileWriteRequest,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import { workspaceFileObserver, type FileObserver } from "../../file-explorer/observer.js";
import { getProjectIcon } from "../../../utils/project-icon.js";

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  emit(msg: SessionOutboundMessage, source?: object): void;
  emitBinary(frame: Uint8Array, source?: object): Promise<void>;
  hasBinaryChannel(): boolean;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  paseoHome: string;
  logger: pino.Logger;
  fileObserver?: FileObserver;
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly logger: pino.Logger;
  private readonly fileUploads: FileUploadStore;
  private readonly fileObserver: FileObserver;

  constructor(options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({ paseoHome: options.paseoHome });
    this.fileObserver = options.fileObserver ?? workspaceFileObserver;
  }

  async handleFileSubscribeRequest(
    request: FileSubscribeRequest,
    ownership: SessionDelivery,
  ): Promise<void> {
    let bootstrap: ReturnType<FileObserver["subscribe"]> | undefined;
    const owner = ownership.begin(
      "files",
      request.subscriptionId,
      async () => {
        await bootstrap?.then(
          (subscription) => subscription.unsubscribe(),
          () => undefined,
        );
      },
      `file:${request.subscriptionId}`,
    );
    let ready = false;
    let pending: FileVersion | null = null;
    const emitVersion = (version: FileVersion) =>
      owner.emit({
        type: "fs.file.update",
        payload: { subscriptionId: owner.responseId, version },
      });
    try {
      bootstrap = this.fileObserver.subscribe(
        { cwd: request.cwd, path: request.path },
        (version) => {
          if (owner.signal.aborted) return;
          if (ready) emitVersion(version);
          else pending = version;
        },
      );
      const subscription = await bootstrap;
      if (owner.signal.aborted) {
        subscription.unsubscribe();
        return;
      }
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: owner.responseId,
          initial: subscription.initial,
          requestId: request.requestId,
        },
      });
      ready = true;
      if (pending) emitVersion(pending);
    } catch (error) {
      await owner.release();
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: owner.responseId,
          initial: {
            status: "error",
            cwd: request.cwd,
            path: request.path,
            error: getErrorMessage(error),
          },
          requestId: request.requestId,
        },
      });
    }
  }

  async handleFileUnsubscribeRequest(
    request: FileUnsubscribeRequest,
    ownership: SessionDelivery,
  ): Promise<void> {
    await ownership.release(request.subscriptionId);
    this.host.emit({
      type: "fs.file.unsubscribe.response",
      payload: {
        subscriptionId: request.subscriptionId,
        requestId: request.requestId,
      },
    });
  }

  async handleFileWriteRequest(request: FileWriteRequest): Promise<void> {
    const result = await writeExplorerFile({
      root: request.cwd,
      relativePath: request.path,
      content: request.content,
      contentEncoding: request.contentEncoding,
      expectedModifiedAt: request.expectedModifiedAt,
      expectedRevision: request.expectedRevision,
    });
    this.host.emit({
      type: "fs.file.write.response",
      payload: { result, requestId: request.requestId },
    });
  }

  async handleFileEntryCreateRequest(request: FileEntryCreateRequest): Promise<void> {
    const result = await createExplorerEntry({
      root: request.cwd,
      parentPath: request.parentPath,
      name: request.name,
      kind: request.kind,
    });
    this.host.emit({
      type: "fs.entry.create.response",
      payload: {
        cwd: request.cwd,
        parentPath: request.parentPath,
        path: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryRenameRequest(request: FileEntryRenameRequest): Promise<void> {
    const result = await renameExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
      name: request.name,
    });
    this.host.emit({
      type: "fs.entry.rename.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        renamedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDuplicateRequest(request: FileEntryDuplicateRequest): Promise<void> {
    const result = await duplicateExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
    });
    this.host.emit({
      type: "fs.entry.duplicate.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        duplicatedPath: result.status === "ok" ? result.path : null,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileEntryDeleteRequest(request: FileEntryDeleteRequest): Promise<void> {
    const result = await deleteExplorerEntry({
      root: request.cwd,
      relativePath: request.path,
    });
    this.host.emit({
      type: "fs.entry.delete.response",
      payload: {
        cwd: request.cwd,
        path: request.path,
        success: result.status === "ok",
        error: result.status === "ok" ? null : result.error,
        requestId: request.requestId,
      },
    });
  }

  async handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd: workspaceCwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: "cwd is required",
            requestId,
          },
        },
        source,
      );
      return;
    }

    try {
      if (mode === "list") {
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.host.emit(
          {
            type: "file_explorer_response",
            payload: {
              cwd,
              path: directory.path,
              mode,
              directory,
              file: null,
              error: null,
              requestId,
            },
          },
          source,
        );
      } else {
        if (request.maxBytes) {
          const file = await getDownloadableFileInfo({
            root: cwd,
            relativePath: requestedPath,
          });
          if (file.size > request.maxBytes) {
            throw new Error("File is too large to display");
          }
        }
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileBegin,
                requestId,
                metadata: {
                  mime: file.mimeType,
                  size: file.size,
                  encoding: file.encoding,
                  modifiedAt: file.modifiedAt,
                  revision: file.revision,
                },
              }),
              source,
            );
            for await (const chunk of file.chunks) {
              await this.host.emitBinary(
                encodeFileTransferFrame({
                  opcode: FileTransferOpcode.FileChunk,
                  requestId,
                  payload: chunk,
                }),
                source,
              );
            }
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileEnd,
                requestId,
              }),
              source,
            );
          });
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emit(
            {
              type: "file_explorer_response",
              payload: {
                cwd,
                path: file.path,
                mode,
                directory: null,
                file,
                error: null,
                requestId,
              },
            },
            source,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: getErrorMessage(error),
            requestId,
          },
        },
        source,
      );
    }
  }

  private async resolveLegacyMutationEntry(
    cwd: string,
    result: import("../../file-explorer/service.js").ExplorerEntryMutationResult,
  ) {
    if (result.status === "error") throw new Error(result.error);
    const slash = result.path.lastIndexOf("/");
    const directory = await listDirectoryEntries({
      root: cwd,
      relativePath: slash < 0 ? "." : result.path.slice(0, slash),
    });
    const entry = directory.entries.find((candidate) => candidate.path === result.path);
    if (!entry) throw new Error("Updated entry unavailable");
    return entry;
  }

  async handleFileExplorerCreateRequest(request: FileExplorerCreateRequest): Promise<void> {
    const { cwd: workspaceCwd, parentPath, name, kind, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file.explorer.create.response",
        payload: {
          cwd: workspaceCwd,
          entry: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      const result = await createExplorerEntry({
        root: cwd,
        parentPath,
        name,
        kind,
      });
      const entry = await this.resolveLegacyMutationEntry(cwd, result);
      this.host.emit({
        type: "file.explorer.create.response",
        payload: {
          cwd,
          entry,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, parentPath, name, kind },
        `Failed to create explorer entry for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file.explorer.create.response",
        payload: {
          cwd,
          entry: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileExplorerRenameRequest(request: FileExplorerRenameRequest): Promise<void> {
    const { cwd: workspaceCwd, path: entryPath, newName, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file.explorer.rename.response",
        payload: {
          cwd: workspaceCwd,
          entry: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      const result = await renameExplorerEntry({
        root: cwd,
        relativePath: entryPath,
        name: newName,
      });
      const entry = await this.resolveLegacyMutationEntry(cwd, result);
      this.host.emit({
        type: "file.explorer.rename.response",
        payload: {
          cwd,
          entry,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: entryPath, newName },
        `Failed to rename explorer entry for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file.explorer.rename.response",
        payload: {
          cwd,
          entry: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileExplorerDeleteRequest(request: FileExplorerDeleteRequest): Promise<void> {
    const { cwd: workspaceCwd, path: entryPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file.explorer.delete.response",
        payload: {
          cwd: workspaceCwd,
          path: entryPath,
          success: false,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      const result = await deleteExplorerEntry({
        root: cwd,
        relativePath: entryPath,
      });
      if (result.status === "error") throw new Error(result.error);
      this.host.emit({
        type: "file.explorer.delete.response",
        payload: {
          cwd,
          path: entryPath,
          success: true,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: entryPath },
        `Failed to delete explorer entry for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file.explorer.delete.response",
        payload: {
          cwd,
          path: entryPath,
          success: false,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileExplorerDuplicateRequest(request: FileExplorerDuplicateRequest): Promise<void> {
    const { cwd: workspaceCwd, path: entryPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file.explorer.duplicate.response",
        payload: {
          cwd: workspaceCwd,
          entry: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    try {
      const result = await duplicateExplorerEntry({
        root: cwd,
        relativePath: entryPath,
      });
      const entry = await this.resolveLegacyMutationEntry(cwd, result);
      this.host.emit({
        type: "file.explorer.duplicate.response",
        payload: {
          cwd,
          entry,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: entryPath },
        `Failed to duplicate explorer entry for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file.explorer.duplicate.response",
        payload: {
          cwd,
          entry: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  handleFileUploadRequest(request: FileUploadRequest, ownership: SessionDelivery): void {
    let cancel: (() => Promise<void>) | undefined;
    const operation = ownership.operation(
      (message) =>
        message.type === "file.upload.response" && message.payload.requestId === request.requestId,
      () => cancel?.(),
    );
    cancel = this.fileUploads.beginUpload(request, operation.source, (response) => {
      if (response) operation.emit(response);
      void operation
        .release()
        .catch((error) => this.logger.error({ err: error }, "Upload cleanup failed"));
    });
  }

  async handleFileTransferFrame(frame: FileTransferFrame, source: object): Promise<void> {
    await this.fileUploads.receiveFrame(frame, source);
  }

  async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      const icon = await getProjectIcon(cwd);
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    this.logger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });

      const entry = this.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: info.path,
          token: entry.token,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }
}
