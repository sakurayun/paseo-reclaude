import { i18n } from "@/i18n/i18next";
import type { Agent } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ResolveArchiveSubagentDialogInput {
  title: Agent["title"] | null | undefined;
  status: Agent["status"] | null | undefined;
}

function resolveSubagentLabel(title: Agent["title"] | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

export function resolveArchiveSubagentDialog(
  input: ResolveArchiveSubagentDialogInput,
): ConfirmDialogInput {
  const subagentLabel =
    resolveSubagentLabel(input.title) ?? i18n.t("subagents.archiveDialog.fallbackLabel");
  const isRunning = input.status === "running";

  return {
    title: isRunning
      ? i18n.t("subagents.archiveDialog.runningTitle")
      : i18n.t("subagents.archiveDialog.title"),
    message: isRunning
      ? i18n.t("subagents.archiveDialog.runningMessage", { label: subagentLabel })
      : i18n.t("subagents.archiveDialog.message", { label: subagentLabel }),
    confirmLabel: i18n.t("subagents.archiveDialog.confirmLabel"),
    cancelLabel: i18n.t("subagents.archiveDialog.cancelLabel"),
    destructive: true,
  };
}

export interface ArchiveSubagentDeps {
  getSubagent: (subagentId: string) => ResolveArchiveSubagentDialogInput | undefined;
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
}

export interface RequestArchiveSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestArchiveSubagent(
  input: RequestArchiveSubagentInput,
  deps: ArchiveSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  const confirmed = await deps.confirm(
    resolveArchiveSubagentDialog({
      title: subagent?.title,
      status: subagent?.status,
    }),
  );
  if (!confirmed) {
    return;
  }
  void deps.archiveAgent({ serverId: input.serverId, agentId: input.subagentId }).catch(() => {});
}
