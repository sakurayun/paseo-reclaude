import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  FlatList,
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import Animated, { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  RefreshCw,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { GitLogCommit } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortenPath } from "@/utils/shorten-path";
import { useCheckoutStatusQuery } from "./use-status-query";
import { useCheckoutGitActionsStore } from "./actions-store";
import { useGitLogQuery } from "./use-git-log-query";
import { RepoActionsMenu } from "./repo-actions-menu";
import { CommitPresetsMenu } from "./commit-presets-menu";
import { layoutCommitGraph, type CommitGraphRowLayout } from "./commit-graph-layout";
import { CommitGraphRow, COMMIT_ROW_HEIGHT } from "./commit-graph-row";
import {
  useGitStatusFilesQuery,
  useStashesQuery,
  type StashEntry,
} from "./use-source-control-queries";
import { ChangedFilesList, ResizableChangesArea } from "./changed-files-list";

const SKELETON_DELAY_MS = 300;
const STAGGER_ROW_COUNT = 12;
const STAGGER_STEP_MS = 35;

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArchive = withUnistyles(Archive);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedTextInput = withUnistyles(TextInput);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentIconMapping = (theme: Theme) => ({ color: theme.colors.accent });
const placeholderColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

interface SourceControlPaneProps {
  serverId: string;
  cwd: string;
  /** Explicit workspace identity for tab lookups (presets → composer). */
  workspaceId?: string | null;
  enabled: boolean;
  onOpenFile?: (filePath: string) => void;
  /** Open a single-file diff preview tab for a changed file. */
  onOpenDiffFile?: (filePath: string) => void;
}

interface CommitListItem {
  commit: GitLogCommit;
  layout: CommitGraphRowLayout;
}

export function SourceControlPane({
  serverId,
  cwd,
  workspaceId,
  enabled,
  onOpenFile,
  onOpenDiffFile,
}: SourceControlPaneProps) {
  const { t } = useTranslation();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitLog === true,
  );
  const hostVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );
  const hostName = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.hostname ?? null,
  );

  if (!supported) {
    // Surface which daemon the client actually reached — over a relay this is
    // the fastest way to spot a stale daemon process still holding the tunnel.
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{t("workspace.sourceControl.updateHost")}</Text>
        <Text style={styles.mutedText}>
          {t("workspace.sourceControl.hostVersion", {
            host: hostName ?? serverId,
            version: hostVersion ?? t("workspace.sourceControl.hostVersionUnknown"),
          })}
        </Text>
      </View>
    );
  }

  return (
    <SourceControlPaneContent
      serverId={serverId}
      cwd={cwd}
      workspaceId={workspaceId}
      enabled={enabled}
      onOpenFile={onOpenFile}
      onOpenDiffFile={onOpenDiffFile}
    />
  );
}

function SourceControlPaneContent({
  serverId,
  cwd,
  workspaceId,
  enabled,
  onOpenFile,
  onOpenDiffFile,
}: SourceControlPaneProps) {
  const { t } = useTranslation();
  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const log = useGitLogQuery({ serverId, cwd, enabled });

  const items = useMemo<CommitListItem[]>(() => {
    const layouts = layoutCommitGraph(log.commits);
    return log.commits.map((commit, index) => ({ commit, layout: layouts[index] }));
  }, [log.commits]);

  // Stagger only the very first page of rows; rows mounted later (pagination,
  // scroll-back virtualization) appear instantly.
  const hasAnimatedInitialRef = useRef(false);
  const hasCommits = items.length > 0;
  useEffect(() => {
    if (hasCommits) {
      const timer = setTimeout(
        () => {
          hasAnimatedInitialRef.current = true;
        },
        STAGGER_ROW_COUNT * STAGGER_STEP_MS + 200,
      );
      return () => clearTimeout(timer);
    }
  }, [hasCommits]);

  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const handleToggleExpand = useCallback((hash: string) => {
    setExpandedHash((current) => (current === hash ? null : hash));
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<CommitListItem>) => {
      const animateIn = !hasAnimatedInitialRef.current && index < STAGGER_ROW_COUNT;
      const row = (
        <CommitGraphRow
          commit={item.commit}
          layout={item.layout}
          serverId={serverId}
          cwd={cwd}
          expanded={expandedHash === item.commit.hash}
          onToggleExpand={handleToggleExpand}
          onOpenFile={onOpenFile}
        />
      );
      if (!animateIn) {
        return row;
      }
      return (
        <Animated.View
          entering={FadeInDown.duration(180)
            .delay(index * STAGGER_STEP_MS)
            .reduceMotion(ReduceMotion.System)}
        >
          {row}
        </Animated.View>
      );
    },
    [serverId, cwd, expandedHash, handleToggleExpand, onOpenFile],
  );

  const keyExtractor = useCallback((item: CommitListItem) => item.commit.hash, []);

  const { hasNextPage, isFetchingNextPage, isLoading, isError, fetchNextPage, refetch } = log;

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const listHeader = useMemo(
    () => <SourceControlHeader serverId={serverId} cwd={cwd} />,
    [serverId, cwd],
  );

  const listFooter = useMemo(
    () =>
      isFetchingNextPage ? (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" />
        </View>
      ) : null,
    [isFetchingNextPage],
  );

  const listEmpty = useMemo(
    () => <CommitListEmptyState isLoading={isLoading} isError={isError} onRetry={handleRetry} />,
    [isLoading, isError, handleRetry],
  );

  return (
    <Animated.View
      style={PANE_CONTAINER_STYLE}
      entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
      testID="source-control-pane"
    >
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={listEmpty}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        style={COMMIT_LIST_STYLE}
      />
      {/* Changes (commit box) pinned below the scrollable history so it is
          always reachable without scrolling back up. */}
      {status?.isGit ? (
        <View style={styles.changesFooter}>
          <ChangesSection
            serverId={serverId}
            cwd={cwd}
            workspaceId={workspaceId}
            isDirty={status.isDirty}
            onOpenFile={onOpenFile}
            onOpenDiffFile={onOpenDiffFile}
          />
        </View>
      ) : null}
      {status?.isGit === false ? (
        <View style={styles.centeredOverlay}>
          <Text style={styles.mutedText}>{t("workspace.git.diff.notRepository")}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

interface SourceControlHeaderProps {
  serverId: string;
  cwd: string;
}

function SourceControlHeader({ serverId, cwd }: SourceControlHeaderProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { status } = useCheckoutStatusQuery({ serverId, cwd });

  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  const runPull = useCheckoutGitActionsStore((s) => s.pull);
  const runPush = useCheckoutGitActionsStore((s) => s.push);
  const refreshStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "refresh" }),
  );
  const pullStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "pull" }),
  );
  const pushStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "push" }),
  );

  const handleRefresh = useCallback(() => {
    void runRefresh({ serverId, cwd }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, runRefresh, serverId, t, toast]);

  const handlePull = useCallback(() => {
    void runPull({ serverId, cwd }).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedPull"),
      );
    });
  }, [cwd, runPull, serverId, t, toast]);

  const handlePush = useCallback(() => {
    void runPush({ serverId, cwd }).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedPush"),
      );
    });
  }, [cwd, runPush, serverId, t, toast]);

  if (!status || !status.isGit) {
    return null;
  }

  const aheadOfOrigin = status.aheadOfOrigin ?? 0;
  const behindOfOrigin = status.behindOfOrigin ?? 0;
  const branchLabel =
    status.currentBranch && status.currentBranch !== "HEAD"
      ? status.currentBranch
      : t("workspace.sourceControl.repo.detached");

  return (
    <View style={styles.header}>
      {/* Sync state + actions. Repository identity (branch, path, remote) is
          folded into the leading icon's detail popover to save header height. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("workspace.sourceControl.sync.title")}</Text>
        <View style={styles.syncRow}>
          <View style={styles.syncLeft}>
            <RepoInfoButton
              branchLabel={branchLabel}
              isDirty={status.isDirty}
              repoRoot={status.repoRoot}
              remoteUrl={status.remoteUrl}
            />
            <SyncCounts
              hasRemote={status.hasRemote}
              ahead={aheadOfOrigin}
              behind={behindOfOrigin}
            />
          </View>
          <View style={styles.syncActions}>
            <SyncActionButton
              label={t("workspace.git.diff.refresh")}
              pending={refreshStatus === "pending"}
              disabled={false}
              onPress={handleRefresh}
              testID="source-control-refresh"
            >
              <ThemedRefreshCw size={12} uniProps={mutedIconMapping} />
            </SyncActionButton>
            <SyncActionButton
              label={t("workspace.git.actions.pull.label")}
              pending={pullStatus === "pending"}
              disabled={!status.hasRemote || behindOfOrigin === 0}
              onPress={handlePull}
              testID="source-control-pull"
            >
              <ThemedArrowDown size={12} uniProps={mutedIconMapping} />
            </SyncActionButton>
            <SyncActionButton
              label={t("workspace.git.actions.push.label")}
              pending={pushStatus === "pending"}
              disabled={!status.hasRemote || aheadOfOrigin === 0}
              onPress={handlePush}
              testID="source-control-push"
            >
              <ThemedArrowUp size={12} uniProps={mutedIconMapping} />
            </SyncActionButton>
            <RepoActionsMenuGate
              serverId={serverId}
              cwd={cwd}
              currentBranch={status.currentBranch}
              hasRemote={status.hasRemote}
              isDirty={status.isDirty}
            />
          </View>
        </View>
      </View>

      <StashesSection serverId={serverId} cwd={cwd} />

      <Text style={styles.sectionTitle}>{t("workspace.sourceControl.history.title")}</Text>
    </View>
  );
}

/**
 * Commit-message box over the dirty state — the "changes" half of a VSCode-style
 * SCM view. Stage-all + commit and stash-save both act on the whole worktree.
 */
function ChangesSection({
  serverId,
  cwd,
  workspaceId,
  isDirty,
  onOpenFile,
  onOpenDiffFile,
}: {
  serverId: string;
  cwd: string;
  workspaceId?: string | null;
  isDirty: boolean;
  onOpenFile?: (filePath: string) => void;
  onOpenDiffFile?: (filePath: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [filesOpen, setFilesOpen] = useState(false);
  const handleFilesToggle = useCallback(() => setFilesOpen((value) => !value), []);

  // COMPAT(checkoutGitOps): added in v0.1.98, drop the gate when floor >= v0.1.98.
  const fileOpsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutGitOps === true,
  );
  const filesQuery = useGitStatusFilesQuery({
    serverId,
    cwd,
    enabled: filesOpen && fileOpsSupported,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const stagedFiles = useMemo(
    () => files.filter((file) => file.indexStatus !== " " && file.indexStatus !== "?"),
    [files],
  );
  const unstagedFiles = useMemo(() => files.filter((file) => file.worktreeStatus !== " "), [files]);
  const hasStaged = stagedFiles.length > 0;

  const runCommit = useCheckoutGitActionsStore((s) => s.commit);
  const runStashSave = useCheckoutGitActionsStore((s) => s.stashSave);
  const commitStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "commit" }),
  );
  const stashSaveStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "stash-save" }),
  );

  const handleCommit = useCallback(() => {
    // With manually staged files, commit only the staged set (VSCode-style);
    // otherwise stage everything as before.
    void runCommit({ serverId, cwd, message, addAll: !hasStaged })
      .then(() => {
        setMessage("");
        toast.show(t("workspace.git.actions.commit.success"), { variant: "success" });
        return;
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.actions.toasts.failedCommit"),
        );
      });
  }, [cwd, hasStaged, message, runCommit, serverId, t, toast]);

  const handleStashSave = useCallback(() => {
    void runStashSave({ serverId, cwd })
      .then(() => {
        toast.show(t("workspace.sourceControl.stashes.saved"), { variant: "success" });
        return;
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.sourceControl.stashes.saveFailed"),
        );
      });
  }, [cwd, runStashSave, serverId, t, toast]);

  const filesCount = filesOpen && filesQuery.data ? files.length : null;
  const changesHeader = useMemo(
    () => (
      <CollapsibleHeader
        title={t("workspace.sourceControl.changes.title")}
        count={filesCount}
        open={filesOpen}
        onToggle={handleFilesToggle}
        testID="source-control-changes-toggle"
      />
    ),
    [t, filesCount, filesOpen, handleFilesToggle],
  );

  return (
    <View style={styles.section}>
      {filesOpen ? (
        <Animated.View entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)}>
          {/* The resize handle renders at the very top of the section, above
              the header row, so the whole changes block grows upward from
              there while the commit box stays pinned below. */}
          <ResizableChangesArea header={changesHeader}>
            {fileOpsSupported ? (
              <ChangedFilesList
                serverId={serverId}
                cwd={cwd}
                stagedFiles={stagedFiles}
                unstagedFiles={unstagedFiles}
                isLoading={filesQuery.isLoading}
                isError={filesQuery.isError}
                onOpenFile={onOpenFile}
                onOpenDiffFile={onOpenDiffFile}
              />
            ) : (
              <Text style={styles.sectionStateText}>{t("workspace.sourceControl.updateHost")}</Text>
            )}
          </ResizableChangesArea>
        </Animated.View>
      ) : (
        changesHeader
      )}
      <View style={styles.changesBody}>
        <ThemedTextInput
          value={message}
          onChangeText={setMessage}
          placeholder={t("workspace.sourceControl.changes.placeholder")}
          multiline
          style={styles.messageInput}
          uniProps={placeholderColorMapping}
          editable={isDirty}
          testID="source-control-commit-message"
        />
        <View style={styles.changesActions}>
          <SyncActionButton
            label={t("workspace.git.actions.commit.label")}
            pending={commitStatus === "pending"}
            disabled={!isDirty}
            onPress={handleCommit}
            testID="source-control-commit"
          >
            <ThemedCheck size={12} uniProps={accentIconMapping} />
          </SyncActionButton>
          <SyncActionButton
            label={t("workspace.sourceControl.stashes.save")}
            pending={stashSaveStatus === "pending"}
            disabled={!isDirty}
            onPress={handleStashSave}
            testID="source-control-stash-save"
          >
            <ThemedArchive size={12} uniProps={mutedIconMapping} />
          </SyncActionButton>
          {!isDirty ? (
            <Text style={styles.changesCleanHint}>
              {t("workspace.sourceControl.changes.clean")}
            </Text>
          ) : null}
          <View style={styles.presetsSlot}>
            <CommitPresetsMenu
              serverId={serverId}
              cwd={cwd}
              workspaceId={workspaceId}
              message={message}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function SectionQueryState({
  isLoading,
  isError,
  isEmpty,
  errorText,
  emptyText,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  errorText: string;
  emptyText: string;
}) {
  if (isLoading) {
    return (
      <View style={styles.sectionStateRow}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (isError) {
    return <Text style={styles.sectionStateText}>{errorText}</Text>;
  }
  if (isEmpty) {
    return <Text style={styles.sectionStateText}>{emptyText}</Text>;
  }
  return null;
}

/** Collapsible section header with a count chip. */
function CollapsibleHeader({
  title,
  count,
  open,
  onToggle,
  testID,
}: {
  title: string;
  count: number | null;
  open: boolean;
  onToggle: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={open ? COLLAPSIBLE_EXPANDED : COLLAPSIBLE_COLLAPSED}
      onPress={onToggle}
      style={styles.collapsibleHeader}
      testID={testID}
    >
      {open ? (
        <ThemedChevronDown size={12} uniProps={mutedIconMapping} />
      ) : (
        <ThemedChevronRight size={12} uniProps={mutedIconMapping} />
      )}
      <Text style={styles.collapsibleTitle}>{title}</Text>
      {count !== null ? <Text style={styles.collapsibleCount}>{count}</Text> : null}
    </Pressable>
  );
}

const COLLAPSIBLE_EXPANDED = { expanded: true } as const;
const COLLAPSIBLE_COLLAPSED = { expanded: false } as const;

/** Every stash in the repo, with one-tap pop. */
function StashesSection({ serverId, cwd }: { serverId: string; cwd: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => setOpen((value) => !value), []);
  const query = useStashesQuery({ serverId, cwd, enabled: open });
  const runStashPop = useCheckoutGitActionsStore((s) => s.stashPop);
  const popStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "stash-pop" }),
  );

  const handlePop = useCallback(
    (stashIndex: number) => {
      void runStashPop({ serverId, cwd, stashIndex })
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
    [cwd, runStashPop, serverId, t, toast],
  );

  const stashes = query.data ?? [];

  return (
    <View style={styles.section}>
      <CollapsibleHeader
        title={t("workspace.sourceControl.stashes.title")}
        count={query.data ? stashes.length : null}
        open={open}
        onToggle={handleToggle}
        testID="source-control-stashes-toggle"
      />
      {open ? (
        <Animated.View entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)}>
          <SectionQueryState
            isLoading={query.isLoading}
            isError={query.isError}
            isEmpty={stashes.length === 0}
            errorText={t("workspace.sourceControl.stashes.error")}
            emptyText={t("workspace.sourceControl.stashes.empty")}
          />
          {!query.isLoading && !query.isError
            ? stashes.map((stash) => (
                <StashRow
                  key={`${stash.index}-${stash.message}`}
                  stash={stash}
                  popping={popStatus === "pending"}
                  onPop={handlePop}
                />
              ))
            : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

function StashRow({
  stash,
  popping,
  onPop,
}: {
  stash: StashEntry;
  popping: boolean;
  onPop: (stashIndex: number) => void;
}) {
  const { t } = useTranslation();
  const handlePop = useCallback(() => onPop(stash.index), [onPop, stash.index]);

  return (
    <View style={styles.listRowContainer}>
      <View style={styles.listRow}>
        <Text style={styles.listRowMeta}>{`#${stash.index}`}</Text>
        <Text style={styles.listRowText} numberOfLines={1}>
          {stash.message}
        </Text>
        {stash.branch ? <Text style={styles.listRowBadge}>{stash.branch}</Text> : null}
        <SyncActionButton
          label={t("workspace.sourceControl.stashes.pop")}
          pending={popping}
          disabled={false}
          onPress={handlePop}
          testID={`source-control-stash-pop-${stash.index}`}
        >
          <ThemedArrowUp size={12} uniProps={mutedIconMapping} />
        </SyncActionButton>
      </View>
    </View>
  );
}

/**
 * Capability gate for the repository actions menu — the button is always
 * visible; on daemons without checkout.git_op support the menu shows an
 * "update the host" notice instead of the actions.
 */
// COMPAT(checkoutGitOps): added in v0.1.98, drop the gate when floor >= v0.1.98.
function RepoActionsMenuGate(props: {
  serverId: string;
  cwd: string;
  currentBranch: string | null;
  hasRemote: boolean;
  isDirty: boolean;
}) {
  const supported = useSessionStore(
    (state) => state.sessions[props.serverId]?.serverInfo?.features?.checkoutGitOps === true,
  );
  return <RepoActionsMenu {...props} supported={supported} />;
}

/**
 * Repository identity behind an icon: hover (desktop) or tap (mobile) shows
 * branch, dirty state, repo path, and remote URL in a popover.
 */
function RepoInfoButton({
  branchLabel,
  isDirty,
  repoRoot,
  remoteUrl,
}: {
  branchLabel: string;
  isDirty: boolean;
  repoRoot: string;
  remoteUrl: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={200} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.sourceControl.repo.title")}
          style={styles.repoInfoButton}
          testID="source-control-repo-info"
        >
          <ThemedGitBranch size={13} uniProps={mutedIconMapping} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" offset={6}>
        <View style={styles.repoTooltipBody}>
          <View style={styles.repoRow}>
            <ThemedGitBranch size={13} uniProps={mutedIconMapping} />
            <Text style={styles.repoValue} numberOfLines={1}>
              {branchLabel}
            </Text>
            <DirtyStateBadge isDirty={isDirty} />
          </View>
          <Text style={styles.repoPath}>{shortenPath(repoRoot)}</Text>
          <Text style={styles.repoRemote}>
            {remoteUrl ?? t("workspace.sourceControl.repo.noRemote")}
          </Text>
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

function DirtyStateBadge({ isDirty }: { isDirty: boolean }) {
  const { t } = useTranslation();
  const containerStyle = useMemo(
    () => [styles.stateBadge, isDirty ? styles.stateBadgeDirty : null],
    [isDirty],
  );
  const textStyle = useMemo(
    () => [styles.stateBadgeText, isDirty ? styles.stateBadgeTextDirty : null],
    [isDirty],
  );
  return (
    <View style={containerStyle}>
      <Text style={textStyle}>
        {isDirty
          ? t("workspace.sourceControl.repo.dirty")
          : t("workspace.sourceControl.repo.clean")}
      </Text>
    </View>
  );
}

interface SyncCountsProps {
  hasRemote: boolean;
  ahead: number;
  behind: number;
}

function SyncCounts({ hasRemote, ahead, behind }: SyncCountsProps) {
  const { t } = useTranslation();
  if (!hasRemote) {
    return (
      <View style={styles.syncCounts}>
        <Text style={styles.syncCountText}>{t("workspace.sourceControl.repo.noRemote")}</Text>
      </View>
    );
  }
  if (ahead === 0 && behind === 0) {
    return (
      <View style={styles.syncCounts}>
        <Text style={styles.syncCountText}>{t("workspace.sourceControl.sync.upToDate")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.syncCounts}>
      {ahead > 0 ? (
        <View style={styles.syncCount}>
          <ThemedArrowUp size={12} uniProps={mutedIconMapping} />
          <Text style={styles.syncCountText}>
            {t("workspace.sourceControl.sync.ahead", { value: ahead })}
          </Text>
        </View>
      ) : null}
      {behind > 0 ? (
        <View style={styles.syncCount}>
          <ThemedArrowDown size={12} uniProps={mutedIconMapping} />
          <Text style={styles.syncCountText}>
            {t("workspace.sourceControl.sync.behind", { value: behind })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface SyncActionButtonProps {
  label: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
  children: React.ReactNode;
}

function SyncActionButton({
  label,
  pending,
  disabled,
  onPress,
  testID,
  children,
}: SyncActionButtonProps) {
  const isDisabled = disabled || pending;
  const accessibilityState = useMemo(() => ({ disabled: isDisabled }), [isDisabled]);
  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.actionButton,
      pressed && !isDisabled ? styles.actionButtonPressed : null,
      isDisabled ? styles.actionButtonDisabled : null,
    ],
    [isDisabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      onPress={onPress}
      disabled={isDisabled}
      style={pressableStyle}
      testID={testID}
    >
      {pending ? <ActivityIndicator size="small" /> : children}
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

interface CommitListEmptyStateProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

function CommitListEmptyState({ isLoading, isError, onRetry }: CommitListEmptyStateProps) {
  const { t } = useTranslation();
  // Flashing a skeleton for fast loads feels worse than a brief blank state;
  // only show it once loading has lasted SKELETON_DELAY_MS.
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (isLoading) {
    return showSkeleton ? <CommitListSkeleton /> : null;
  }
  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{t("workspace.sourceControl.history.error")}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{t("workspace.git.diff.refresh")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.centered}>
      <Text style={styles.mutedText}>{t("workspace.sourceControl.history.empty")}</Text>
    </View>
  );
}

const SKELETON_ROW_KEYS = [0, 1, 2, 3, 4, 5].map((i) => `commit-skeleton-${i}`);

function CommitListSkeleton() {
  const pulse = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const animation = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const pulseStyles = useMemo(() => {
    const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
    return {
      dot: [skeletonStaticStyles.dot, { opacity }],
      lineWide: [skeletonStaticStyles.lineWide, { opacity }],
      lineNarrow: [skeletonStaticStyles.lineNarrow, { opacity }],
    };
  }, [pulse]);

  return (
    <View testID="source-control-skeleton">
      {SKELETON_ROW_KEYS.map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <RNAnimated.View style={pulseStyles.dot} />
          <View style={styles.skeletonTextColumn}>
            <RNAnimated.View style={pulseStyles.lineWide} />
            <RNAnimated.View style={pulseStyles.lineNarrow} />
          </View>
        </View>
      ))}
    </View>
  );
}

const PANE_CONTAINER_STYLE = { flex: 1 } as const;
// The history list takes the leftover height above the pinned changes footer.
const COMMIT_LIST_STYLE = { flex: 1 } as const;

// Skeleton bars animate opacity via RN Animated — keep their styles static so
// Unistyles never patches a node Animated also manages.
const skeletonStaticStyles = RNStyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(127, 127, 127, 0.45)",
  },
  lineWide: {
    height: 8,
    width: "80%",
    borderRadius: 4,
    backgroundColor: "rgba(127, 127, 127, 0.45)",
  },
  lineNarrow: {
    height: 7,
    width: "45%",
    borderRadius: 4,
    backgroundColor: "rgba(127, 127, 127, 0.3)",
  },
});

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  centeredOverlay: {
    ...RNStyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceSidebar,
  },
  mutedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  header: {
    paddingTop: theme.spacing[3],
  },
  section: {
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  repoInfoButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  repoTooltipBody: {
    maxWidth: 280,
    gap: theme.spacing[1],
    padding: theme.spacing[1],
  },
  repoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  repoValue: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  repoPath: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  repoRemote: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  stateBadge: {
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
  },
  stateBadgeDirty: {
    borderColor: theme.colors.statusWarning,
  },
  stateBadgeText: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
  },
  stateBadgeTextDirty: {
    color: theme.colors.statusWarning,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    flexWrap: "wrap",
  },
  syncLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  syncCounts: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  syncCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  syncCountText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  syncActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionButtonPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  footerLoading: {
    paddingVertical: theme.spacing[3],
    alignItems: "center",
  },
  retryButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: COMMIT_ROW_HEIGHT,
    paddingHorizontal: theme.spacing[3],
  },
  skeletonTextColumn: {
    flex: 1,
    gap: theme.spacing[1],
  },
  changesFooter: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
  },
  changesBody: {
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
  },
  messageInput: {
    minHeight: 56,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
  changesActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
  },
  changesCleanHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginLeft: theme.spacing[1],
  },
  presetsSlot: {
    marginLeft: "auto",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
  },
  collapsibleTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  collapsibleCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  sectionStateRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "flex-start",
  },
  sectionStateText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  listRowContainer: {
    position: "relative",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[3],
  },
  listRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  listRowText: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  listRowTextCurrent: {
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.medium,
  },
  listRowBadge: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
  },
  listRowMeta: {
    marginLeft: "auto",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
