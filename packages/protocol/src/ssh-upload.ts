// Wire convention for SFTP upload binary frames: file bytes ride the existing
// file_transfer frames (FileBegin/FileChunk/FileEnd), and this requestId prefix
// is what routes them to the SSH upload runtime instead of the workspace
// file-upload store. Both sides must build/parse ids through these helpers.

export const SSH_UPLOAD_FRAME_PREFIX = "sshup:";

// Frame requestIds are capped at 255 bytes by the binary frame format, and the
// separator must never appear inside either id.
const ID_SEPARATOR = ":";
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isSshUploadFrameId(requestId: string): boolean {
  return requestId.startsWith(SSH_UPLOAD_FRAME_PREFIX);
}

export function buildSshUploadFrameId(uploadId: string, fileId: string): string {
  if (!SAFE_ID_PATTERN.test(uploadId) || !SAFE_ID_PATTERN.test(fileId)) {
    throw new RangeError("SSH upload ids must be alphanumeric with - or _");
  }
  return `${SSH_UPLOAD_FRAME_PREFIX}${uploadId}${ID_SEPARATOR}${fileId}`;
}

export interface SshUploadFrameId {
  uploadId: string;
  fileId: string;
}

export function parseSshUploadFrameId(requestId: string): SshUploadFrameId | null {
  if (!isSshUploadFrameId(requestId)) {
    return null;
  }
  const body = requestId.slice(SSH_UPLOAD_FRAME_PREFIX.length);
  const separatorIndex = body.indexOf(ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === body.length - 1) {
    return null;
  }
  const uploadId = body.slice(0, separatorIndex);
  const fileId = body.slice(separatorIndex + 1);
  if (!SAFE_ID_PATTERN.test(uploadId) || !SAFE_ID_PATTERN.test(fileId)) {
    return null;
  }
  return { uploadId, fileId };
}
