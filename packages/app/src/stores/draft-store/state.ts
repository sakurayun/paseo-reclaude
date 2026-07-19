import {
  NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER,
  type AttachmentMetadata,
  type ChatHistoryContextAttachment,
  type UserComposerAttachment,
} from "@/attachments/types";
import { ForgeSearchItemSchema, GitHubSearchItemSchema } from "@getpaseo/protocol/messages";
import { buildChatHistoryAttachmentId } from "@/attachments/chat-history-identity";

export const DRAFT_STORE_VERSION = 6;
export const FINALIZED_DRAFT_TTL_MS = 5 * 60 * 1000;

export interface LegacyDraftImage {
  uri: string;
  mimeType?: string;
}

export type PersistedDraftImage = AttachmentMetadata | LegacyDraftImage;

export interface DraftInput {
  text: string;
  attachments: UserComposerAttachment[];
  transcriptAttachments: ChatHistoryContextAttachment[];
}

export interface DraftTranscriptSource {
  serverId: string;
  agentId: string;
}

export type DraftLifecycleState = "active" | "abandoned" | "sent";

export type CanonicalDraftInput = DraftInput;

export interface DraftRecord {
  input: CanonicalDraftInput;
  lifecycle: DraftLifecycleState;
  updatedAt: number;
  version: number;
}

export interface DraftStoreState {
  drafts: Record<string, DraftRecord>;
  createModalDraft: DraftRecord | null;
}

export function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.storageType === "string" &&
    typeof record.storageKey === "string" &&
    typeof record.createdAt === "number"
  );
}

export function isLegacyDraftImage(value: unknown): value is LegacyDraftImage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.uri === "string";
}

export function normalizeAttachmentMetadata(image: AttachmentMetadata): AttachmentMetadata {
  return {
    id: image.id,
    mimeType: image.mimeType,
    storageType: image.storageType,
    storageKey: image.storageKey,
    createdAt: image.createdAt,
    ...(typeof image.fileName === "string" || image.fileName === null
      ? { fileName: image.fileName }
      : {}),
    ...(typeof image.byteSize === "number" || image.byteSize === null
      ? { byteSize: image.byteSize }
      : {}),
  };
}

export function isUserComposerAttachment(value: unknown): value is UserComposerAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "image") {
    const metadata = record.metadata;
    return isAttachmentMetadata(metadata);
  }
  if (
    record.kind !== "forge_issue" &&
    record.kind !== "forge_change_request" &&
    record.kind !== "github_issue" &&
    record.kind !== "github_pr"
  ) {
    return false;
  }
  if (
    record.kind === "github_pr" &&
    record.owner !== undefined &&
    record.owner !== NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER
  ) {
    return false;
  }
  return (
    ForgeSearchItemSchema.safeParse(record.item).success ||
    GitHubSearchItemSchema.safeParse(record.item).success
  );
}

export function normalizeComposerAttachment(
  attachment: UserComposerAttachment,
): UserComposerAttachment {
  if (attachment.kind === "image") {
    return {
      kind: "image",
      metadata: normalizeAttachmentMetadata(attachment.metadata),
    };
  }
  if (attachment.kind === "github_pr") {
    const item =
      (attachment.item as { kind: string }).kind === "pr"
        ? { ...attachment.item, kind: "change_request" as const }
        : attachment.item;
    return {
      kind: "github_pr",
      item,
      ...(attachment.owner === NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER
        ? { owner: attachment.owner }
        : {}),
    };
  }
  return attachment;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTranscriptBoundaryCursor(
  value: unknown,
): value is NonNullable<ChatHistoryContextAttachment["source"]["boundaryCursor"]> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cursor = value as Record<string, unknown>;
  return typeof cursor.epoch === "string" && isNonnegativeInteger(cursor.seq);
}

function isOptionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalNonnegativeInteger(value: unknown): boolean {
  return value === undefined || isNonnegativeInteger(value);
}

function isOptionalTranscriptBoundaryCursor(value: unknown): boolean {
  return value === undefined || value === null || isTranscriptBoundaryCursor(value);
}

function isChatHistoryTextAttachment(
  value: unknown,
): value is ChatHistoryContextAttachment["attachment"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const attachment = value as Record<string, unknown>;
  const title = attachment.title;
  return (
    attachment.type === "text" &&
    attachment.mimeType === "text/plain" &&
    attachment.contextKind === "chat_history" &&
    typeof attachment.text === "string" &&
    (title === undefined || title === null || typeof title === "string")
  );
}

function isChatHistorySource(value: unknown): value is ChatHistoryContextAttachment["source"] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const source = value as Record<string, unknown>;
  return (
    typeof source.serverId === "string" &&
    typeof source.agentId === "string" &&
    (source.workspaceLabel === undefined || typeof source.workspaceLabel === "string") &&
    (source.serverLabel === undefined || typeof source.serverLabel === "string") &&
    (source.capturedWhileRunning === undefined ||
      typeof source.capturedWhileRunning === "boolean") &&
    isOptionalStringOrNull(source.boundaryMessageId) &&
    isOptionalTranscriptBoundaryCursor(source.boundaryCursor) &&
    isOptionalNonnegativeInteger(source.itemCount) &&
    isOptionalNonnegativeInteger(source.includedItemCount) &&
    isOptionalNonnegativeInteger(source.byteCount) &&
    (source.truncated === undefined || typeof source.truncated === "boolean")
  );
}

export function isChatHistoryContextAttachment(
  value: unknown,
): value is ChatHistoryContextAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const attachment = value as Record<string, unknown>;
  return (
    attachment.kind === "chat_history" &&
    typeof attachment.id === "string" &&
    isChatHistoryTextAttachment(attachment.attachment) &&
    isChatHistorySource(attachment.source)
  );
}

export function buildDraftTranscriptAttachmentId(input: DraftTranscriptSource): string {
  return buildChatHistoryAttachmentId(input);
}

export function normalizeDraftTranscriptAttachment(
  attachment: ChatHistoryContextAttachment,
): ChatHistoryContextAttachment {
  const source = attachment.source;
  const title = attachment.attachment.title;
  const workspaceLabel = source.workspaceLabel?.trim();
  const serverLabel = source.serverLabel?.trim();
  const capturedWhileRunning = source.capturedWhileRunning;
  const boundaryMessageId = source.boundaryMessageId;
  const boundaryCursor = source.boundaryCursor;
  const itemCount = source.itemCount;
  const includedItemCount = source.includedItemCount;
  const byteCount = source.byteCount;
  const truncated = source.truncated;

  return {
    kind: "chat_history",
    id: buildDraftTranscriptAttachmentId(source),
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      text: attachment.attachment.text,
      ...(typeof title === "string" || title === null ? { title } : {}),
    },
    source: {
      serverId: source.serverId,
      agentId: source.agentId,
      ...(workspaceLabel ? { workspaceLabel } : {}),
      ...(serverLabel ? { serverLabel } : {}),
      ...(typeof capturedWhileRunning === "boolean" ? { capturedWhileRunning } : {}),
      ...(typeof boundaryMessageId === "string" || boundaryMessageId === null
        ? { boundaryMessageId }
        : {}),
      ...(isTranscriptBoundaryCursor(boundaryCursor)
        ? {
            boundaryCursor: {
              epoch: boundaryCursor.epoch,
              seq: boundaryCursor.seq,
            },
          }
        : {}),
      ...(isNonnegativeInteger(itemCount) ? { itemCount } : {}),
      ...(isNonnegativeInteger(includedItemCount) ? { includedItemCount } : {}),
      ...(isNonnegativeInteger(byteCount) ? { byteCount } : {}),
      ...(typeof truncated === "boolean" ? { truncated } : {}),
    },
  };
}

function isCanonicalDraftTranscriptAttachment(
  value: unknown,
): value is ChatHistoryContextAttachment {
  if (!isChatHistoryContextAttachment(value)) {
    return false;
  }
  return value.id === buildDraftTranscriptAttachmentId(value.source);
}

export function upsertDraftTranscriptAttachment(input: {
  attachments: readonly ChatHistoryContextAttachment[];
  attachment: ChatHistoryContextAttachment;
}): ChatHistoryContextAttachment[] {
  const nextAttachment = normalizeDraftTranscriptAttachment(input.attachment);
  const existingIndex = input.attachments.findIndex(
    (current) =>
      current.source.serverId === nextAttachment.source.serverId &&
      current.source.agentId === nextAttachment.source.agentId,
  );
  if (existingIndex < 0) {
    return [...input.attachments, nextAttachment];
  }
  return input.attachments.map((current, index) =>
    index === existingIndex ? nextAttachment : current,
  );
}

export function normalizeDraftTranscriptAttachments(
  attachments: readonly ChatHistoryContextAttachment[],
): ChatHistoryContextAttachment[] {
  return attachments.reduce<ChatHistoryContextAttachment[]>(
    (current, attachment) => upsertDraftTranscriptAttachment({ attachments: current, attachment }),
    [],
  );
}

export function removeDraftTranscriptAttachment(input: {
  attachments: readonly ChatHistoryContextAttachment[];
  source: DraftTranscriptSource;
}): ChatHistoryContextAttachment[] {
  return input.attachments.filter(
    (attachment) =>
      attachment.source.serverId !== input.source.serverId ||
      attachment.source.agentId !== input.source.agentId,
  );
}

export function isCanonicalDraftInput(value: unknown): value is CanonicalDraftInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Record<string, unknown>;
  // COMPAT(draft-cwd): accept legacy persisted drafts that include cwd. Stop accepting after 2026-11-09.
  return (
    typeof input.text === "string" &&
    Array.isArray(input.attachments) &&
    input.attachments.every(isUserComposerAttachment) &&
    Array.isArray(input.transcriptAttachments) &&
    input.transcriptAttachments.every(isCanonicalDraftTranscriptAttachment) &&
    new Set(input.transcriptAttachments.map((attachment) => attachment.id)).size ===
      input.transcriptAttachments.length
  );
}

export function toDraftInputIfReady(
  record: DraftRecord | null | undefined,
): DraftInput | undefined {
  if (!record) {
    return undefined;
  }
  if (record.lifecycle !== "active") {
    return undefined;
  }
  if (!isCanonicalDraftInput(record.input)) {
    return undefined;
  }
  return {
    text: record.input.text,
    attachments: record.input.attachments.map(normalizeComposerAttachment),
    transcriptAttachments: record.input.transcriptAttachments.map(
      normalizeDraftTranscriptAttachment,
    ),
  };
}

export function collectReferencedAttachmentIdsFromState(state: DraftStoreState): Set<string> {
  const referencedIds = new Set<string>();

  for (const draftRecord of Object.values(state.drafts)) {
    if (draftRecord.lifecycle !== "active") {
      continue;
    }
    if (!isCanonicalDraftInput(draftRecord.input)) {
      continue;
    }
    for (const attachment of draftRecord.input.attachments) {
      if (attachment.kind === "image") {
        referencedIds.add(attachment.metadata.id);
      }
    }
  }

  const modalRecord = state.createModalDraft;
  if (modalRecord?.lifecycle === "active" && isCanonicalDraftInput(modalRecord.input)) {
    for (const attachment of modalRecord.input.attachments) {
      if (attachment.kind === "image") {
        referencedIds.add(attachment.metadata.id);
      }
    }
  }

  return referencedIds;
}

export function pruneFinalizedDraftRecords(input: {
  drafts: Record<string, DraftRecord>;
  nowMs: number;
}): Record<string, DraftRecord> {
  let changed = false;
  const next: Record<string, DraftRecord> = {};
  for (const [draftKey, record] of Object.entries(input.drafts)) {
    if (record.lifecycle !== "active" && input.nowMs - record.updatedAt >= FINALIZED_DRAFT_TTL_MS) {
      changed = true;
      continue;
    }
    next[draftKey] = record;
  }
  return changed ? next : input.drafts;
}

export function applyClearDraftRecord(input: {
  record: DraftRecord;
  lifecycle?: Exclude<DraftLifecycleState, "active">;
  nowMs: number;
}): DraftRecord | null {
  if (!input.lifecycle) {
    return null;
  }

  return {
    ...input.record,
    input: { text: "", attachments: [], transcriptAttachments: [] },
    lifecycle: input.lifecycle,
    updatedAt: input.nowMs,
    version: input.record.version + 1,
  };
}
