import type { TFunction } from "i18next";

import { confirmDialog } from "@/utils/confirm-dialog";

export interface WorktreeArchiveRisk {
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
}

export interface WorktreeArchiveConfirmationInput extends WorktreeArchiveRisk {
  worktreeName: string;
}

function formatDiffStat(
  diffStat: WorktreeArchiveRisk["diffStat"],
  t: TFunction<"git">,
): string | null {
  if (!diffStat) {
    return null;
  }

  const parts: string[] = [];
  if (diffStat.additions > 0) {
    parts.push(t("archive.diffStat.added", { count: diffStat.additions }));
  }
  if (diffStat.deletions > 0) {
    parts.push(t("archive.diffStat.deleted", { count: diffStat.deletions }));
  }

  return parts.length > 0 ? parts.join(t("archive.diffStat.separator")) : null;
}

export function buildWorktreeArchiveRiskReasons(
  input: WorktreeArchiveRisk,
  t: TFunction<"git">,
): string[] {
  const reasons: string[] = [];
  const diffStat = input.diffStat;
  const hasDiffStatChanges = diffStat ? diffStat.additions > 0 || diffStat.deletions > 0 : false;
  const hasUncommittedChanges =
    input.isDirty === true || (input.isDirty == null && hasDiffStatChanges);

  if (hasUncommittedChanges) {
    const diffStatLabel = formatDiffStat(diffStat, t);
    reasons.push(
      diffStatLabel
        ? t("archive.reason.uncommittedChangesWithStat", { stat: diffStatLabel })
        : t("archive.reason.uncommittedChanges"),
    );
  }

  if ((input.aheadOfOrigin ?? 0) > 0) {
    const aheadOfOrigin = input.aheadOfOrigin ?? 0;
    reasons.push(t("archive.reason.unpushedCommits", { count: aheadOfOrigin }));
  }

  return reasons;
}

export function buildWorktreeArchiveConfirmationMessage(
  input: WorktreeArchiveConfirmationInput,
  t: TFunction<"git">,
): string | null {
  const reasons = buildWorktreeArchiveRiskReasons(input, t);
  if (reasons.length === 0) {
    return null;
  }

  return reasons.join("\n");
}

export async function confirmRiskyWorktreeArchive(
  input: WorktreeArchiveConfirmationInput,
  t: TFunction<"git">,
): Promise<boolean> {
  const message = buildWorktreeArchiveConfirmationMessage(input, t);
  if (!message) {
    return true;
  }

  return await confirmDialog({
    title: t("archive.confirm.title", { worktreeName: input.worktreeName }),
    message,
    confirmLabel: t("archive.confirm.confirmLabel"),
    cancelLabel: t("archive.confirm.cancelLabel"),
    destructive: true,
  });
}
