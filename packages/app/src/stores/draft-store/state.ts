import {
  NEW_WORKSPACE_PICKER_ATTACHMENT_OWNER,
  type AttachmentMetadata,
  type UserComposerAttachment,
} from "@/attachments/types";
import { ForgeSearchItemSchema, GitHubSearchItemSchema } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";

export const DRAFT_STORE_VERSION = 5;
export const FINALIZED_DRAFT_TTL_MS = 5 * 60 * 1000;

export interface LegacyDraftImage {
  uri: string;
  mimeType?: string;
}

export type PersistedDraftImage = AttachmentMetadata | LegacyDraftImage;

export interface DraftInput {
  text: string;
  attachments: UserComposerAttachment[];
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

export function isCanonicalDraftInput(value: unknown): value is CanonicalDraftInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Record<string, unknown>;
  // COMPAT(draft-cwd): accept legacy persisted drafts that include cwd. Stop accepting after 2026-11-09.
  return (
    typeof input.text === "string" &&
    Array.isArray(input.attachments) &&
    input.attachments.every(isUserComposerAttachment)
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
    input: { text: "", attachments: [] },
    lifecycle: input.lifecycle,
    updatedAt: input.nowMs,
    version: input.record.version + 1,
  };
}
