import {
  NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER,
  type AttachmentMetadata,
  type ChatHistoryContextAttachment,
  type UserComposerAttachment,
} from "@/attachments/types";
import { buildChatHistoryAttachmentId } from "@/attachments/chat-history-identity";
import type { StreamItem } from "@/types/stream";
import { PluginResourceComposerAttachmentSchema } from "@/plugins/attachments";
import { z } from "zod";

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

export function editDraftRecordText(
  record: DraftRecord | undefined,
  text: string,
  now: number,
): DraftRecord {
  if (record?.lifecycle === "active" && record.input.text === text) return record;
  const attachments = record?.lifecycle === "active" ? record.input.attachments : [];
  const transcriptAttachments =
    record?.lifecycle === "active" ? (record.input.transcriptAttachments ?? []) : [];
  return {
    input: { text, attachments, transcriptAttachments },
    lifecycle:
      text.length > 0 || attachments.length > 0 || transcriptAttachments.length > 0
        ? "active"
        : "abandoned",
    updatedAt: now,
    version: (record?.version ?? 0) + 1,
  };
}

export interface DraftStoreState {
  drafts: Record<string, DraftRecord>;
  createModalDraft: DraftRecord | null;
}

export const AttachmentMetadataSchema = z.strictObject({
  id: z.string(),
  mimeType: z.string(),
  storageType: z.enum(["web-indexeddb", "desktop-file", "native-file"]),
  storageKey: z.string(),
  fileName: z.string().nullable().optional(),
  byteSize: z.number().nullable().optional(),
  createdAt: z.number(),
}) satisfies z.ZodType<AttachmentMetadata>;
export const LegacyDraftImageSchema: z.ZodType<LegacyDraftImage> = z.strictObject({
  uri: z.string(),
  mimeType: z.string().optional(),
});
const UploadedFileSchema = z.strictObject({
  type: z.literal("uploaded_file"),
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  path: z.string(),
});
const ForgeItemFields = {
  forge: z.string().optional(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
};
const IssueItemSchema = z.strictObject({ kind: z.literal("issue"), ...ForgeItemFields });
const ChangeRequestItemSchema = z.strictObject({
  kind: z.literal("change_request"),
  ...ForgeItemFields,
});
export const UserComposerAttachmentSchema: z.ZodType<UserComposerAttachment> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("image"), metadata: AttachmentMetadataSchema }),
    z.strictObject({ kind: z.literal("file"), attachment: UploadedFileSchema }),
    z.strictObject({
      kind: z.literal("workspace_file"),
      path: z.string(),
      selection: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("whole_file") }),
        z.strictObject({
          kind: z.literal("line_range"),
          startLine: z.number().int().positive(),
          endLine: z.number().int().positive(),
        }),
      ]),
    }),
    z.strictObject({ kind: z.literal("forge_issue"), item: IssueItemSchema }),
    z.strictObject({ kind: z.literal("forge_change_request"), item: ChangeRequestItemSchema }),
    z.strictObject({ kind: z.literal("github_issue"), item: IssueItemSchema }),
    PluginResourceComposerAttachmentSchema,
    z.strictObject({
      kind: z.literal("github_pr"),
      item: ChangeRequestItemSchema,
      owner: z.literal(NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER).optional(),
    }),
  ],
);
export const CanonicalDraftInputSchema = z.strictObject({
  text: z.string(),
  attachments: z.array(UserComposerAttachmentSchema),
  transcriptAttachments: z
    .array(z.custom<ChatHistoryContextAttachment>(isChatHistoryContextAttachment))
    .default([]),
  // COMPAT(draft-cwd): accept legacy persisted drafts that include cwd. Stop accepting after 2026-11-09.
  cwd: z.string().optional(),
});
const DraftRecordSchema: z.ZodType<DraftRecord> = z.strictObject({
  input: CanonicalDraftInputSchema,
  lifecycle: z.enum(["active", "abandoned", "sent"]),
  updatedAt: z.number(),
  version: z.number().int().positive(),
});
export const DraftStoreStateSchema: z.ZodType<DraftStoreState> = z.strictObject({
  drafts: z.record(z.string(), DraftRecordSchema),
  createModalDraft: DraftRecordSchema.nullable(),
});

export function isAttachmentMetadata(value: unknown): value is AttachmentMetadata {
  return AttachmentMetadataSchema.safeParse(value).success;
}

export function isLegacyDraftImage(value: unknown): value is LegacyDraftImage {
  return LegacyDraftImageSchema.safeParse(value).success;
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
  return UserComposerAttachmentSchema.safeParse(value).success;
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
  if (attachment.kind === "workspace_file") {
    return {
      kind: "workspace_file",
      path: attachment.path.trim().replace(/^\.\//, ""),
      selection: attachment.selection,
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
  return (
    CanonicalDraftInputSchema.safeParse(value).success &&
    Array.isArray((value as DraftInput).transcriptAttachments)
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
    transcriptAttachments: (record.input.transcriptAttachments ?? []).map(
      normalizeDraftTranscriptAttachment,
    ),
  };
}

export function hasDraftInputContent(input: DraftInput): boolean {
  return (
    input.text.trim().length > 0 ||
    input.attachments.length > 0 ||
    input.transcriptAttachments.length > 0
  );
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

function collectDraftImageAttachmentIds(attachments: UserComposerAttachment[]): Set<string> {
  const ids = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      ids.add(attachment.metadata.id);
    }
  }
  return ids;
}

export function haveDraftImageReferencesChanged(
  previous: UserComposerAttachment[],
  next: UserComposerAttachment[],
): boolean {
  if (previous.length === 0 && next.length === 0) {
    return false;
  }
  const previousIds = collectDraftImageAttachmentIds(previous);
  const nextIds = collectDraftImageAttachmentIds(next);
  if (previousIds.size !== nextIds.size) {
    return true;
  }
  for (const id of previousIds) {
    if (!nextIds.has(id)) {
      return true;
    }
  }
  return false;
}

export function collectStreamUserImageIds(
  streams: ReadonlyMap<string, StreamItem[]>,
  referencedIds: Set<string>,
): number {
  let scannedItems = 0;
  for (const stream of streams.values()) {
    for (const item of stream) {
      scannedItems += 1;
      if (item.kind !== "user_message") continue;
      for (const image of item.images ?? []) {
        referencedIds.add(image.id);
      }
    }
  }
  return scannedItems;
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
