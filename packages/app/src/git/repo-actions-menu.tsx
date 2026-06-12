import { useCallback, useMemo, useState } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { CheckoutGitOp } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionStore } from "@/stores/session-store";
import { queryClient as appQueryClient } from "@/query/query-client";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { useCheckoutGitActionsStore } from "./actions-store";
import { useBranchesQuery, useGitRefsQuery, useStashesQuery } from "./use-source-control-queries";
import type { BranchDetail, StashEntry } from "./use-source-control-queries";

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const BACK_LEADING = <ThemedChevronLeft size={14} uniProps={mutedIconMapping} />;
const CATEGORY_TRAILING = <ThemedChevronRight size={14} uniProps={mutedIconMapping} />;

/**
 * VSCode-style repository actions menu. Submenus are flat pages inside one
 * dropdown (category rows navigate forward, the header row navigates back) —
 * the shared DropdownMenu has no nested-menu support and this stays
 * cross-platform. Pages are described as data so every row renders through one
 * memo-friendly item component with a single stable action callback.
 */
type MenuPage =
  | "root"
  | "commit"
  | "changes"
  | "pullPush"
  | "branch"
  | "branchMerge"
  | "branchRebase"
  | "branchDelete"
  | "remote"
  | "remoteRemove"
  | "stash"
  | "stashApply"
  | "stashPop"
  | "stashDrop"
  | "tags"
  | "tagDelete"
  | "tagDeleteRemote";

type InputModal =
  | { kind: "create-branch" }
  | { kind: "rename-branch" }
  | { kind: "create-tag" }
  | { kind: "remote-name" }
  | { kind: "remote-url"; remoteName: string };

interface OpConfirm {
  title: string;
  message: string;
}

type MenuEntry =
  | { type: "separator"; key: string }
  | { type: "back"; key: string; label: string; page: MenuPage }
  | { type: "category"; key: string; label: string; page: MenuPage; testID?: string }
  | { type: "info"; key: string; label: string }
  | {
      type: "op";
      key: string;
      label: string;
      op: CheckoutGitOp;
      args?: { name?: string; url?: string; addAll?: boolean; stashIndex?: number };
      disabled?: boolean;
      destructive?: boolean;
      description?: string;
      confirm?: OpConfirm;
    }
  | { type: "modal"; key: string; label: string; modal: InputModal }
  | { type: "stash-pop"; key: string; label: string; stashIndex: number };

interface RepoActionsMenuProps {
  serverId: string;
  cwd: string;
  currentBranch: string | null;
  hasRemote: boolean;
  isDirty: boolean;
  /** Daemon capability (server_info.features.checkoutGitOps). */
  supported: boolean;
}

function buildRootEntries(t: TFunction, hasRemote: boolean): MenuEntry[] {
  return [
    {
      type: "op",
      key: "pull-rebase",
      label: t("workspace.sourceControl.menu.pullRebase"),
      op: "pull-rebase",
      disabled: !hasRemote,
    },
    {
      type: "op",
      key: "fetch",
      label: t("workspace.sourceControl.menu.fetch"),
      op: "fetch",
      disabled: !hasRemote,
    },
    { type: "separator", key: "sep-1" },
    {
      type: "category",
      key: "commit",
      label: t("workspace.sourceControl.menu.commit"),
      page: "commit",
      testID: "source-control-menu-commit",
    },
    {
      type: "category",
      key: "changes",
      label: t("workspace.sourceControl.menu.changes"),
      page: "changes",
      testID: "source-control-menu-changes",
    },
    {
      type: "category",
      key: "pull-push",
      label: t("workspace.sourceControl.menu.pullPush"),
      page: "pullPush",
      testID: "source-control-menu-pull-push",
    },
    {
      type: "category",
      key: "branch",
      label: t("workspace.sourceControl.menu.branch"),
      page: "branch",
      testID: "source-control-menu-branch",
    },
    {
      type: "category",
      key: "remote",
      label: t("workspace.sourceControl.menu.remote"),
      page: "remote",
      testID: "source-control-menu-remote",
    },
    {
      type: "category",
      key: "stash",
      label: t("workspace.sourceControl.menu.stash"),
      page: "stash",
      testID: "source-control-menu-stash",
    },
    {
      type: "category",
      key: "tags",
      label: t("workspace.sourceControl.menu.tags"),
      page: "tags",
      testID: "source-control-menu-tags",
    },
  ];
}

function buildCommitEntries(t: TFunction): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.commit"), page: "root" },
    {
      type: "op",
      key: "undo-last-commit",
      label: t("workspace.sourceControl.menu.undoLastCommit"),
      op: "undo-last-commit",
    },
    {
      type: "op",
      key: "abort-rebase",
      label: t("workspace.sourceControl.menu.abortRebase"),
      op: "abort-rebase",
    },
    { type: "separator", key: "sep-1" },
    {
      type: "op",
      key: "amend-staged",
      label: t("workspace.sourceControl.menu.commitStagedAmend"),
      op: "commit-amend",
    },
    {
      type: "op",
      key: "amend-all",
      label: t("workspace.sourceControl.menu.commitAllAmend"),
      op: "commit-amend",
      args: { addAll: true },
    },
  ];
}

function buildChangesEntries(t: TFunction, isDirty: boolean): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.changes"), page: "root" },
    {
      type: "op",
      key: "stage-all",
      label: t("workspace.sourceControl.menu.stageAll"),
      op: "stage-all",
      disabled: !isDirty,
    },
    {
      type: "op",
      key: "unstage-all",
      label: t("workspace.sourceControl.menu.unstageAll"),
      op: "unstage-all",
    },
    {
      type: "op",
      key: "discard-all",
      label: t("workspace.sourceControl.menu.discardAll"),
      op: "discard-all",
      disabled: !isDirty,
      destructive: true,
      confirm: {
        title: t("workspace.sourceControl.menu.discardAllConfirmTitle"),
        message: t("workspace.sourceControl.menu.discardAllConfirmMessage"),
      },
    },
  ];
}

function buildPullPushEntries(t: TFunction, hasRemote: boolean): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.pullPush"), page: "root" },
    {
      type: "op",
      key: "pull-rebase",
      label: t("workspace.sourceControl.menu.pullRebase"),
      op: "pull-rebase",
      disabled: !hasRemote,
    },
    { type: "separator", key: "sep-1" },
    {
      type: "op",
      key: "publish-branch",
      label: t("workspace.sourceControl.menu.publishBranch"),
      op: "publish-branch",
      disabled: !hasRemote,
    },
    { type: "separator", key: "sep-2" },
    {
      type: "op",
      key: "fetch",
      label: t("workspace.sourceControl.menu.fetch"),
      op: "fetch",
      disabled: !hasRemote,
    },
    {
      type: "op",
      key: "fetch-prune",
      label: t("workspace.sourceControl.menu.fetchPrune"),
      op: "fetch-prune",
      disabled: !hasRemote,
    },
    {
      type: "op",
      key: "fetch-all",
      label: t("workspace.sourceControl.menu.fetchAll"),
      op: "fetch-all",
      disabled: !hasRemote,
    },
  ];
}

function buildBranchEntries(t: TFunction, hasRemote: boolean): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.branch"), page: "root" },
    {
      type: "category",
      key: "merge",
      label: t("workspace.sourceControl.menu.mergeBranch"),
      page: "branchMerge",
    },
    {
      type: "category",
      key: "rebase",
      label: t("workspace.sourceControl.menu.rebaseBranch"),
      page: "branchRebase",
    },
    { type: "separator", key: "sep-1" },
    {
      type: "modal",
      key: "create",
      label: t("workspace.sourceControl.menu.createBranch"),
      modal: { kind: "create-branch" },
    },
    {
      type: "modal",
      key: "rename",
      label: t("workspace.sourceControl.menu.renameBranch"),
      modal: { kind: "rename-branch" },
    },
    {
      type: "category",
      key: "delete",
      label: t("workspace.sourceControl.menu.deleteBranch"),
      page: "branchDelete",
    },
    { type: "separator", key: "sep-2" },
    {
      type: "op",
      key: "publish",
      label: t("workspace.sourceControl.menu.publishBranch"),
      op: "publish-branch",
      disabled: !hasRemote,
    },
  ];
}

function buildBranchPickerEntries(input: {
  t: TFunction;
  page: "branchMerge" | "branchRebase" | "branchDelete";
  branches: BranchDetail[];
  isLoading: boolean;
  currentBranch: string | null;
}): MenuEntry[] {
  const { t, page, branches, isLoading, currentBranch } = input;
  const titles: Record<typeof page, string> = {
    branchMerge: t("workspace.sourceControl.menu.mergeBranch"),
    branchRebase: t("workspace.sourceControl.menu.rebaseBranch"),
    branchDelete: t("workspace.sourceControl.menu.deleteBranch"),
  };
  const entries: MenuEntry[] = [{ type: "back", key: "back", label: titles[page], page: "branch" }];
  if (isLoading) {
    entries.push({ type: "info", key: "loading", label: t("common.loading") });
    return entries;
  }
  const candidates = branches.filter((branch) => branch.name !== currentBranch);
  if (candidates.length === 0) {
    entries.push({
      type: "info",
      key: "empty",
      label: t("workspace.sourceControl.branches.empty"),
    });
    return entries;
  }
  for (const branch of candidates) {
    if (page === "branchMerge") {
      entries.push({
        type: "op",
        key: branch.name,
        label: branch.name,
        op: "merge-ref",
        args: { name: branch.name },
      });
    } else if (page === "branchRebase") {
      entries.push({
        type: "op",
        key: branch.name,
        label: branch.name,
        op: "rebase-ref",
        args: { name: branch.name },
      });
    } else {
      entries.push({
        type: "op",
        key: branch.name,
        label: branch.name,
        op: "delete-branch",
        args: { name: branch.name },
        destructive: true,
        confirm: {
          title: t("workspace.sourceControl.menu.deleteBranchConfirmTitle", {
            branch: branch.name,
          }),
          message: t("workspace.sourceControl.menu.deleteBranchConfirmMessage"),
        },
      });
    }
  }
  return entries;
}

function buildRemoteEntries(t: TFunction): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.remote"), page: "root" },
    {
      type: "modal",
      key: "add",
      label: t("workspace.sourceControl.menu.addRemote"),
      modal: { kind: "remote-name" },
    },
    {
      type: "category",
      key: "remove",
      label: t("workspace.sourceControl.menu.removeRemote"),
      page: "remoteRemove",
    },
  ];
}

function buildRemoteRemoveEntries(input: {
  t: TFunction;
  remotes: Array<{ name: string; url: string }>;
  isLoading: boolean;
}): MenuEntry[] {
  const { t, remotes, isLoading } = input;
  const entries: MenuEntry[] = [
    {
      type: "back",
      key: "back",
      label: t("workspace.sourceControl.menu.removeRemote"),
      page: "remote",
    },
  ];
  if (isLoading) {
    entries.push({ type: "info", key: "loading", label: t("common.loading") });
    return entries;
  }
  if (remotes.length === 0) {
    entries.push({
      type: "info",
      key: "empty",
      label: t("workspace.sourceControl.menu.noRemotes"),
    });
    return entries;
  }
  for (const remote of remotes) {
    entries.push({
      type: "op",
      key: remote.name,
      label: remote.name,
      description: remote.url,
      op: "remote-remove",
      args: { name: remote.name },
      destructive: true,
      confirm: {
        title: t("workspace.sourceControl.menu.removeRemoteConfirmTitle", {
          remote: remote.name,
        }),
        message: t("workspace.sourceControl.menu.removeRemoteConfirmMessage"),
      },
    });
  }
  return entries;
}

function buildStashEntries(t: TFunction, isDirty: boolean): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.stash"), page: "root" },
    {
      type: "op",
      key: "stash",
      label: t("workspace.sourceControl.menu.stashPlain"),
      op: "stash",
      disabled: !isDirty,
    },
    {
      type: "op",
      key: "stash-untracked",
      label: t("workspace.sourceControl.menu.stashUntracked"),
      op: "stash-untracked",
      disabled: !isDirty,
    },
    {
      type: "op",
      key: "stash-staged",
      label: t("workspace.sourceControl.menu.stashStaged"),
      op: "stash-staged",
      disabled: !isDirty,
    },
    { type: "separator", key: "sep-1" },
    {
      type: "op",
      key: "apply-latest",
      label: t("workspace.sourceControl.menu.applyLatestStash"),
      op: "stash-apply",
      args: { stashIndex: 0 },
    },
    {
      type: "category",
      key: "apply",
      label: t("workspace.sourceControl.menu.applyStash"),
      page: "stashApply",
    },
    {
      type: "stash-pop",
      key: "pop-latest",
      label: t("workspace.sourceControl.menu.popLatestStash"),
      stashIndex: 0,
    },
    {
      type: "category",
      key: "pop",
      label: t("workspace.sourceControl.menu.popStash"),
      page: "stashPop",
    },
    { type: "separator", key: "sep-2" },
    {
      type: "category",
      key: "drop",
      label: t("workspace.sourceControl.menu.dropStash"),
      page: "stashDrop",
    },
    {
      type: "op",
      key: "clear",
      label: t("workspace.sourceControl.menu.clearStashes"),
      op: "stash-clear",
      destructive: true,
      confirm: {
        title: t("workspace.sourceControl.menu.clearStashesConfirmTitle"),
        message: t("workspace.sourceControl.menu.clearStashesConfirmMessage"),
      },
    },
  ];
}

function buildStashPickerEntries(input: {
  t: TFunction;
  page: "stashApply" | "stashPop" | "stashDrop";
  stashes: StashEntry[];
  isLoading: boolean;
}): MenuEntry[] {
  const { t, page, stashes, isLoading } = input;
  const titles: Record<typeof page, string> = {
    stashApply: t("workspace.sourceControl.menu.applyStash"),
    stashPop: t("workspace.sourceControl.menu.popStash"),
    stashDrop: t("workspace.sourceControl.menu.dropStash"),
  };
  const entries: MenuEntry[] = [{ type: "back", key: "back", label: titles[page], page: "stash" }];
  if (isLoading) {
    entries.push({ type: "info", key: "loading", label: t("common.loading") });
    return entries;
  }
  if (stashes.length === 0) {
    entries.push({
      type: "info",
      key: "empty",
      label: t("workspace.sourceControl.menu.noStashes"),
    });
    return entries;
  }
  for (const stash of stashes) {
    const label = `#${stash.index} ${stash.message}`;
    if (page === "stashApply") {
      entries.push({
        type: "op",
        key: String(stash.index),
        label,
        op: "stash-apply",
        args: { stashIndex: stash.index },
      });
    } else if (page === "stashPop") {
      entries.push({
        type: "stash-pop",
        key: String(stash.index),
        label,
        stashIndex: stash.index,
      });
    } else {
      entries.push({
        type: "op",
        key: String(stash.index),
        label,
        op: "stash-drop",
        args: { stashIndex: stash.index },
        destructive: true,
        confirm: {
          title: t("workspace.sourceControl.menu.dropStashConfirmTitle"),
          message: t("workspace.sourceControl.menu.dropStashConfirmMessage"),
        },
      });
    }
  }
  return entries;
}

function buildTagsEntries(t: TFunction, hasRemote: boolean): MenuEntry[] {
  return [
    { type: "back", key: "back", label: t("workspace.sourceControl.menu.tags"), page: "root" },
    {
      type: "modal",
      key: "create",
      label: t("workspace.sourceControl.menu.createTag"),
      modal: { kind: "create-tag" },
    },
    {
      type: "category",
      key: "delete",
      label: t("workspace.sourceControl.menu.deleteTag"),
      page: "tagDelete",
    },
    {
      type: "category",
      key: "delete-remote",
      label: t("workspace.sourceControl.menu.deleteRemoteTag"),
      page: "tagDeleteRemote",
    },
    { type: "separator", key: "sep-1" },
    {
      type: "op",
      key: "push-tags",
      label: t("workspace.sourceControl.menu.pushTags"),
      op: "push-tags",
      disabled: !hasRemote,
    },
  ];
}

function buildTagPickerEntries(input: {
  t: TFunction;
  page: "tagDelete" | "tagDeleteRemote";
  tags: string[];
  isLoading: boolean;
}): MenuEntry[] {
  const { t, page, tags, isLoading } = input;
  const title =
    page === "tagDelete"
      ? t("workspace.sourceControl.menu.deleteTag")
      : t("workspace.sourceControl.menu.deleteRemoteTag");
  const entries: MenuEntry[] = [{ type: "back", key: "back", label: title, page: "tags" }];
  if (isLoading) {
    entries.push({ type: "info", key: "loading", label: t("common.loading") });
    return entries;
  }
  if (tags.length === 0) {
    entries.push({ type: "info", key: "empty", label: t("workspace.sourceControl.menu.noTags") });
    return entries;
  }
  for (const tag of tags) {
    entries.push({
      type: "op",
      key: tag,
      label: tag,
      op: page === "tagDelete" ? "tag-delete" : "tag-delete-remote",
      args: { name: tag },
      destructive: true,
    });
  }
  return entries;
}

interface BuildEntriesInput {
  page: MenuPage;
  t: TFunction;
  hasRemote: boolean;
  isDirty: boolean;
  currentBranch: string | null;
  branches: BranchDetail[];
  branchesLoading: boolean;
  stashes: StashEntry[];
  stashesLoading: boolean;
  remotes: Array<{ name: string; url: string }>;
  tags: string[];
  refsLoading: boolean;
}

function buildPickerEntriesForPage(input: BuildEntriesInput): MenuEntry[] | null {
  const { page, t } = input;
  if (page === "branchMerge" || page === "branchRebase" || page === "branchDelete") {
    return buildBranchPickerEntries({
      t,
      page,
      branches: input.branches,
      isLoading: input.branchesLoading,
      currentBranch: input.currentBranch,
    });
  }
  if (page === "stashApply" || page === "stashPop" || page === "stashDrop") {
    return buildStashPickerEntries({
      t,
      page,
      stashes: input.stashes,
      isLoading: input.stashesLoading,
    });
  }
  if (page === "remoteRemove") {
    return buildRemoteRemoveEntries({ t, remotes: input.remotes, isLoading: input.refsLoading });
  }
  if (page === "tagDelete" || page === "tagDeleteRemote") {
    return buildTagPickerEntries({ t, page, tags: input.tags, isLoading: input.refsLoading });
  }
  return null;
}

function buildEntriesForPage(input: BuildEntriesInput): MenuEntry[] {
  const picker = buildPickerEntriesForPage(input);
  if (picker) {
    return picker;
  }
  const { page, t, hasRemote, isDirty } = input;
  switch (page) {
    case "commit":
      return buildCommitEntries(t);
    case "changes":
      return buildChangesEntries(t, isDirty);
    case "pullPush":
      return buildPullPushEntries(t, hasRemote);
    case "branch":
      return buildBranchEntries(t, hasRemote);
    case "remote":
      return buildRemoteEntries(t);
    case "stash":
      return buildStashEntries(t, isDirty);
    case "tags":
      return buildTagsEntries(t, hasRemote);
    default:
      return buildRootEntries(t, hasRemote);
  }
}

export function RepoActionsMenu({
  serverId,
  cwd,
  currentBranch,
  hasRemote,
  isDirty,
  supported,
}: RepoActionsMenuProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>("root");
  const [modal, setModal] = useState<InputModal | null>(null);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setPage("root");
    }
  }, []);

  const gitOp = useCheckoutGitActionsStore((s) => s.gitOp);
  const stashPop = useCheckoutGitActionsStore((s) => s.stashPop);
  const client = useSessionStore((s) => s.sessions[serverId]?.client ?? null);

  const branchPickerOpen =
    page === "branchMerge" || page === "branchRebase" || page === "branchDelete";
  const stashPickerOpen = page === "stashApply" || page === "stashPop" || page === "stashDrop";
  const refsPickerOpen =
    page === "remoteRemove" || page === "tagDelete" || page === "tagDeleteRemote";

  const branchesQuery = useBranchesQuery({ serverId, cwd, enabled: open && branchPickerOpen });
  const stashesQuery = useStashesQuery({ serverId, cwd, enabled: open && stashPickerOpen });
  const refsQuery = useGitRefsQuery({ serverId, cwd, enabled: open && refsPickerOpen });

  const runOp = useCallback(
    (
      op: CheckoutGitOp,
      args?: { name?: string; url?: string; addAll?: boolean; stashIndex?: number },
    ) => {
      void gitOp({ serverId, cwd, op, ...args })
        .then(() => {
          toast.show(t("workspace.sourceControl.menu.opSuccess"), { variant: "success" });
          return;
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : t("workspace.sourceControl.menu.opFailed"),
          );
        });
    },
    [cwd, gitOp, serverId, t, toast],
  );

  const handleStashPop = useCallback(
    (stashIndex: number) => {
      void stashPop({ serverId, cwd, stashIndex })
        .then(() => {
          toast.show(t("workspace.sourceControl.stashes.popped"), { variant: "success" });
          return;
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : t("workspace.sourceControl.stashes.popFailed"),
          );
        });
    },
    [cwd, serverId, stashPop, t, toast],
  );

  const handleAction = useCallback(
    (entry: MenuEntry) => {
      switch (entry.type) {
        case "back":
        case "category":
          setPage(entry.page);
          break;
        case "modal":
          setModal(entry.modal);
          break;
        case "stash-pop":
          handleStashPop(entry.stashIndex);
          break;
        case "op": {
          const { op, args, confirm } = entry;
          if (!confirm) {
            runOp(op, args);
            break;
          }
          void confirmDialog({
            title: confirm.title,
            message: confirm.message,
            confirmLabel: t("workspace.sourceControl.menu.confirm"),
            cancelLabel: t("common.actions.cancel"),
            destructive: true,
          }).then((confirmed) => {
            if (confirmed) {
              runOp(op, args);
            }
            return;
          });
          break;
        }
        default:
          break;
      }
    },
    [handleStashPop, runOp, t],
  );

  const entries = useMemo<MenuEntry[]>(() => {
    if (!supported) {
      // Feature contract: the entry stays visible, the menu tells the user to
      // update the host instead of offering a degraded fallback.
      return [{ type: "info", key: "unsupported", label: t("workspace.sourceControl.updateHost") }];
    }
    return buildEntriesForPage({
      page,
      t,
      hasRemote,
      isDirty,
      currentBranch,
      branches: branchesQuery.data ?? [],
      branchesLoading: branchesQuery.isLoading,
      stashes: stashesQuery.data ?? [],
      stashesLoading: stashesQuery.isLoading,
      remotes: refsQuery.data?.remotes ?? [],
      tags: refsQuery.data?.tags ?? [],
      refsLoading: refsQuery.isLoading,
    });
  }, [
    supported,
    page,
    t,
    hasRemote,
    isDirty,
    currentBranch,
    branchesQuery.data,
    branchesQuery.isLoading,
    stashesQuery.data,
    stashesQuery.isLoading,
    refsQuery.data,
    refsQuery.isLoading,
  ]);

  const handleRenameBranch = useCallback(
    async (value: string) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.renameBranch({ cwd, branch: value });
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      await invalidateCheckoutGitQueriesForClient(appQueryClient, { serverId, cwd });
    },
    [client, cwd, serverId, t],
  );

  const handleCreateBranchSubmit = useCallback(
    (value: string) => {
      runOp("create-branch", { name: value });
    },
    [runOp],
  );

  const handleCreateTagSubmit = useCallback(
    (value: string) => {
      runOp("tag-create", { name: value });
    },
    [runOp],
  );

  const handleRemoteNameSubmit = useCallback((value: string) => {
    // Two-step input: capture the name, then ask for the URL.
    setModal({ kind: "remote-url", remoteName: value });
  }, []);

  const handleRemoteUrlSubmit = useCallback(
    (value: string) => {
      if (modal?.kind === "remote-url") {
        runOp("remote-add", { name: modal.remoteName, url: value });
      }
    },
    [modal, runOp],
  );

  const closeModal = useCallback(() => setModal(null), []);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("workspace.sourceControl.menu.trigger")}
          style={styles.triggerButton}
          testID="source-control-actions-menu"
        >
          <ThemedMoreHorizontal size={12} uniProps={mutedIconMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={260} testID="source-control-actions-menu-content">
          {entries.map((entry) => (
            <MenuEntryItem
              key={`${entry.type}-${entry.key}`}
              entry={entry}
              onAction={handleAction}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AdaptiveRenameModal
        visible={modal?.kind === "create-branch"}
        title={t("workspace.sourceControl.menu.createBranchTitle")}
        initialValue=""
        placeholder={t("workspace.sourceControl.menu.branchNamePlaceholder")}
        onClose={closeModal}
        onSubmit={handleCreateBranchSubmit}
      />
      <AdaptiveRenameModal
        visible={modal?.kind === "rename-branch"}
        title={t("workspace.sourceControl.menu.renameBranchTitle")}
        initialValue={currentBranch ?? ""}
        placeholder={t("workspace.sourceControl.menu.branchNamePlaceholder")}
        onClose={closeModal}
        onSubmit={handleRenameBranch}
      />
      <AdaptiveRenameModal
        visible={modal?.kind === "create-tag"}
        title={t("workspace.sourceControl.menu.createTagTitle")}
        initialValue=""
        placeholder={t("workspace.sourceControl.menu.tagNamePlaceholder")}
        onClose={closeModal}
        onSubmit={handleCreateTagSubmit}
      />
      <AdaptiveRenameModal
        visible={modal?.kind === "remote-name"}
        title={t("workspace.sourceControl.menu.addRemoteNameTitle")}
        initialValue=""
        placeholder={t("workspace.sourceControl.menu.remoteNamePlaceholder")}
        onClose={closeModal}
        onSubmit={handleRemoteNameSubmit}
      />
      <AdaptiveRenameModal
        visible={modal?.kind === "remote-url"}
        title={t("workspace.sourceControl.menu.addRemoteUrlTitle")}
        initialValue=""
        placeholder={t("workspace.sourceControl.menu.remoteUrlPlaceholder")}
        onClose={closeModal}
        onSubmit={handleRemoteUrlSubmit}
      />
    </>
  );
}

function MenuEntryItem({
  entry,
  onAction,
}: {
  entry: MenuEntry;
  onAction: (entry: MenuEntry) => void;
}) {
  const handleSelect = useCallback(() => onAction(entry), [entry, onAction]);

  if (entry.type === "separator") {
    return <DropdownMenuSeparator />;
  }
  if (entry.type === "back") {
    return (
      <>
        <DropdownMenuItem closeOnSelect={false} onSelect={handleSelect} leading={BACK_LEADING}>
          {entry.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </>
    );
  }
  if (entry.type === "category") {
    return (
      <DropdownMenuItem
        closeOnSelect={false}
        onSelect={handleSelect}
        trailing={CATEGORY_TRAILING}
        testID={entry.testID}
      >
        {entry.label}
      </DropdownMenuItem>
    );
  }
  if (entry.type === "info") {
    return <DropdownMenuItem disabled>{entry.label}</DropdownMenuItem>;
  }
  if (entry.type === "op") {
    return (
      <DropdownMenuItem
        onSelect={handleSelect}
        disabled={entry.disabled}
        destructive={entry.destructive}
        description={entry.description}
      >
        {entry.label}
      </DropdownMenuItem>
    );
  }
  return <DropdownMenuItem onSelect={handleSelect}>{entry.label}</DropdownMenuItem>;
}

const styles = StyleSheet.create((theme) => ({
  triggerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
