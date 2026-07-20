import React, { useCallback, useEffect, useMemo, useReducer } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, History } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import { getChatHistorySourceKey } from "@/attachments/chat-history-identity";
import { getProviderIcon } from "@/components/provider-icons";
import { useAgentHistory, type AgentHistoryUnavailableHost } from "@/hooks/use-agent-history";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import { formatTimeAgo } from "@/utils/time";
import {
  buildTranscriptSourceGroups,
  getTranscriptSourceKey,
  INITIAL_TRANSCRIPT_PICKER_STATE,
  MAX_TRANSCRIPT_ATTACHMENTS,
  reduceTranscriptPickerState,
  selectTranscriptUnavailableHosts,
  type TranscriptDestination,
  type TranscriptSourceGroupKind,
} from "@/components/add-transcripts-sheet-view-model";
import { exportSelectedTranscripts } from "@/components/add-transcripts-export";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

const ThemedCheck = withUnistyles(Check);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedHistory = withUnistyles(History);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const TRANSCRIPT_SHEET_SNAP_POINTS = ["72%", "92%"];
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const accentForegroundColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface DynamicProviderIconProps {
  provider: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ provider, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(provider);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withUnistyles(DynamicProviderIcon);

interface AddTranscriptsSheetProps {
  visible: boolean;
  destination: TranscriptDestination;
  existingAttachments: readonly ChatHistoryContextAttachment[];
  onClose: () => void;
  onAddTranscript: (attachment: ChatHistoryContextAttachment) => void;
}

function resolveAgentTitle(agent: AggregatedAgent): string {
  return (
    agent.title?.trim() || agent.projectPlacement?.workspaceName?.trim() || agent.cwd || agent.id
  );
}

function sourceGroupLabel(
  kind: TranscriptSourceGroupKind,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (kind === "workspace") {
    return t("addTranscripts.groups.thisWorkspace");
  }
  if (kind === "project") {
    return t("addTranscripts.groups.otherWorkspaces");
  }
  return t("addTranscripts.groups.sameRepository");
}

function buildSourceMeta(agent: AggregatedAgent): string {
  const workspace = agent.projectPlacement?.workspaceName?.trim() || agent.cwd;
  const parts = [agent.provider, workspace];
  if (agent.serverLabel.trim()) {
    parts.push(agent.serverLabel);
  }
  return parts.join(" · ");
}

function TranscriptProviderIcon({ provider }: { provider: AggregatedAgent["provider"] }) {
  return (
    <ThemedDynamicProviderIcon
      provider={provider}
      size={ICON_SIZE.md}
      uniProps={mutedColorMapping}
    />
  );
}

function TranscriptSourceRow({
  agent,
  selected,
  disabled,
  unavailable,
  error,
  onToggle,
}: {
  agent: AggregatedAgent;
  selected: boolean;
  disabled: boolean;
  unavailable: boolean;
  error: string | null;
  onToggle: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const toggleSource = onToggle;
  const title = resolveAgentTitle(agent);
  let statusNotice: string | null = null;
  if (error) {
    statusNotice = error;
  } else if (unavailable) {
    statusNotice = t("addTranscripts.status.updateHost");
  } else if (agent.status === "running") {
    statusNotice = t("addTranscripts.status.runningSnapshot");
  }
  const accessibilityLabel = [title, buildSourceMeta(agent), statusNotice]
    .filter((value): value is string => Boolean(value))
    .join(". ");
  const accessibilityState = useMemo(() => ({ checked: selected, disabled }), [disabled, selected]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (Boolean(hovered) || selected) && styles.rowHovered,
      pressed && styles.rowPressed,
      disabled && styles.rowDisabled,
    ],
    [disabled, selected],
  );
  const selectionControlStyle = useMemo(
    () => [styles.selectionControl, selected && styles.selectionControlSelected],
    [selected],
  );
  const handlePress = useCallback(() => {
    toggleSource(agent);
  }, [agent, toggleSource]);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      aria-checked={selected}
      disabled={disabled}
      onPress={handlePress}
      style={pressableStyle}
      testID={`add-transcripts-source-${agent.serverId}-${agent.id}`}
    >
      <View style={selectionControlStyle}>
        {selected ? <ThemedCheck size={12} uniProps={accentForegroundColorMapping} /> : null}
      </View>
      <View style={styles.rowIconWrap}>
        <TranscriptProviderIcon provider={agent.provider} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowTime}>{formatTimeAgo(agent.lastActivityAt)}</Text>
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {buildSourceMeta(agent)}
        </Text>
        {unavailable ? (
          <Text style={styles.rowNotice}>{t("addTranscripts.status.updateHost")}</Text>
        ) : null}
        {!unavailable && agent.status === "running" ? (
          <Text style={styles.rowNotice}>{t("addTranscripts.status.runningSnapshot")}</Text>
        ) : null}
        {error ? (
          <Text style={styles.rowError} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SelectionStatus({
  isLoading,
  isError,
  hasSources,
  hasAnySources,
  hasQuery,
  hasUnavailableHosts,
  onRefresh,
}: {
  isLoading: boolean;
  isError: boolean;
  hasSources: boolean;
  hasAnySources: boolean;
  hasQuery: boolean;
  hasUnavailableHosts: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <View style={styles.statusRow} testID="add-transcripts-loading">
        <ThemedLoadingSpinner size={ICON_SIZE.md} uniProps={mutedColorMapping} />
        <Text style={styles.statusText}>{t("addTranscripts.status.loading")}</Text>
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.statusRow} testID="add-transcripts-error">
        <ThemedCircleAlert size={ICON_SIZE.md} uniProps={destructiveColorMapping} />
        <Text style={styles.errorText}>{t("addTranscripts.status.failedToLoad")}</Text>
        <Button size="xs" variant="ghost" onPress={onRefresh}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  if (!hasSources && !hasUnavailableHosts) {
    return (
      <View style={styles.emptyState} testID="add-transcripts-empty">
        <ThemedHistory size={ICON_SIZE.lg} uniProps={mutedColorMapping} strokeWidth={1.5} />
        <Text style={styles.emptyStateTitle}>
          {hasAnySources && hasQuery
            ? t("addTranscripts.status.noMatches")
            : t("addTranscripts.status.noTranscripts")}
        </Text>
      </View>
    );
  }
  return null;
}

type TranscriptListItem =
  | { kind: "group"; key: string; groupKind: TranscriptSourceGroupKind }
  | { kind: "source"; key: string; agent: AggregatedAgent };

function TranscriptPickerList({
  groups,
  selection,
  errorsBySource,
  sourceSupportsTranscriptExport,
  isAdding,
  onToggleSource,
  virtualized,
  header,
  footer,
}: {
  groups: ReturnType<typeof buildTranscriptSourceGroups>;
  selection: readonly string[];
  errorsBySource: Readonly<Record<string, string>>;
  sourceSupportsTranscriptExport: ReadonlyMap<string, boolean | undefined>;
  isAdding: boolean;
  onToggleSource: (agent: AggregatedAgent) => void;
  virtualized: boolean;
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const { t } = useTranslation();
  const items = useMemo<TranscriptListItem[]>(
    () =>
      groups.flatMap((group) => [
        { kind: "group" as const, key: `group:${group.kind}`, groupKind: group.kind },
        ...group.agents.map((agent) => ({
          kind: "source" as const,
          key: getTranscriptSourceKey(agent),
          agent,
        })),
      ]),
    [groups],
  );
  const renderSource = useCallback(
    (agent: AggregatedAgent) => {
      const key = getTranscriptSourceKey(agent);
      const unavailable = sourceSupportsTranscriptExport.get(agent.serverId) !== true;
      return (
        <TranscriptSourceRow
          agent={agent}
          selected={selection.includes(key)}
          disabled={isAdding || unavailable}
          unavailable={unavailable}
          error={errorsBySource[key] ?? null}
          onToggle={onToggleSource}
        />
      );
    },
    [errorsBySource, isAdding, onToggleSource, selection, sourceSupportsTranscriptExport],
  );
  const renderItem = useCallback(
    ({ item }: { item: TranscriptListItem }) =>
      item.kind === "group" ? (
        <Text style={styles.virtualizedGroupTitle}>{sourceGroupLabel(item.groupKind, t)}</Text>
      ) : (
        renderSource(item.agent)
      ),
    [renderSource, t],
  );
  const keyExtractor = useCallback((item: TranscriptListItem) => item.key, []);
  const listHeaderComponent = useMemo(
    () => <View style={styles.listHeader}>{header}</View>,
    [header],
  );
  const listFooterComponent = useMemo(
    () => <View style={styles.listFooter}>{footer}</View>,
    [footer],
  );

  if (virtualized) {
    return (
      <BottomSheetFlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.virtualizedList}
        contentContainerStyle={styles.virtualizedListContent}
        ListHeaderComponent={listHeaderComponent}
        ListFooterComponent={listFooterComponent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={18}
        maxToRenderPerBatch={16}
        windowSize={7}
      />
    );
  }

  return (
    <>
      {header}
      <View style={styles.list}>
        {groups.map((group) => (
          <View key={group.kind} style={styles.group}>
            <Text style={styles.groupTitle}>{sourceGroupLabel(group.kind, t)}</Text>
            {group.agents.map((agent) => (
              <View key={getTranscriptSourceKey(agent)}>{renderSource(agent)}</View>
            ))}
          </View>
        ))}
      </View>
      {footer}
    </>
  );
}

function UnavailableHostsNotice({
  hosts,
  onRefresh,
}: {
  hosts: readonly AgentHistoryUnavailableHost[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  if (hosts.length === 0) {
    return null;
  }
  const canRetry = hosts.some((host) => host.reason === "history_failed");

  return (
    <Alert
      variant="warning"
      description={t("addTranscripts.status.hostsUnavailable", {
        hosts: hosts.map((host) => host.serverLabel).join(", "),
      })}
      testID="add-transcripts-unavailable-hosts"
    >
      {canRetry ? (
        <Button size="sm" variant="outline" onPress={onRefresh}>
          {t("common.actions.retry")}
        </Button>
      ) : null}
    </Alert>
  );
}

export function AddTranscriptsSheet({
  visible,
  destination,
  existingAttachments,
  onClose,
  onAddTranscript,
}: AddTranscriptsSheetProps) {
  const { t } = useTranslation();
  const useVirtualizedList = useIsCompactFormFactor() && isNative;
  const history = useAgentHistory({ enabled: visible });
  const [pickerState, dispatchPicker] = useReducer(
    reduceTranscriptPickerState,
    INITIAL_TRANSCRIPT_PICKER_STATE,
  );
  const { query, selection, errorsBySource, selectionError, isAdding, searchResetKey } =
    pickerState;

  const sourceServerIds = useMemo(
    () => [...new Set(history.agents.map((agent) => agent.serverId))],
    [history.agents],
  );
  const sourceSupportsTranscriptExport = useHostFeatureMap(
    sourceServerIds,
    "agentTranscriptExport",
  );
  const allGroups = useMemo(
    () => buildTranscriptSourceGroups({ agents: history.agents, destination, query: "" }),
    [destination, history.agents],
  );
  const groups = useMemo(
    () => buildTranscriptSourceGroups({ agents: history.agents, destination, query }),
    [destination, history.agents, query],
  );
  const unavailableHosts = useMemo(
    () =>
      selectTranscriptUnavailableHosts({
        hosts: history.unavailableHosts,
        destinationServerId: destination.serverId,
      }),
    [destination.serverId, history.unavailableHosts],
  );
  const sourcesByKey = useMemo(() => {
    const entries = allGroups.flatMap((group) => group.agents);
    return new Map(entries.map((agent) => [getTranscriptSourceKey(agent), agent]));
  }, [allGroups]);
  const existingSourceKeys = useMemo(
    () =>
      new Set(existingAttachments.map((attachment) => getChatHistorySourceKey(attachment.source))),
    [existingAttachments],
  );
  const selectedSources = useMemo(
    () =>
      selection.flatMap((key) => {
        const source = sourcesByKey.get(key);
        return source ? [source] : [];
      }),
    [selection, sourcesByKey],
  );

  useEffect(() => {
    if (!visible && !isAdding) {
      dispatchPicker({ type: "reset" });
    }
  }, [isAdding, visible]);

  const handleClose = useCallback(() => {
    if (!isAdding) {
      onClose();
    }
  }, [isAdding, onClose]);

  const handleToggleSource = useCallback(
    (source: AggregatedAgent) => {
      dispatchPicker({
        type: "toggle_source",
        key: getTranscriptSourceKey(source),
        existingSourceKeys,
        maximumError: t("addTranscripts.status.maximumSelected", {
          count: MAX_TRANSCRIPT_ATTACHMENTS,
        }),
      });
    },
    [existingSourceKeys, t],
  );

  const handleSearchChange = useCallback((value: string) => {
    dispatchPicker({ type: "set_query", query: value });
  }, []);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("addTranscripts.title"),
      subtitle: <Text style={styles.headerSubtitle}>{t("addTranscripts.subtitle")}</Text>,
      search: {
        onChange: handleSearchChange,
        resetKey: searchResetKey,
        placeholder: t("addTranscripts.searchPlaceholder"),
        testID: "add-transcripts-search",
      },
    }),
    [handleSearchChange, searchResetKey, t],
  );

  const handleAdd = useCallback(async () => {
    if (selectedSources.length === 0 || isAdding) {
      return;
    }
    dispatchPicker({ type: "start_add" });
    const runtime = getHostRuntimeStore();
    const result = await exportSelectedTranscripts({
      sources: selectedSources,
      existingAttachments,
      getClient: (serverId) => runtime.getClient(serverId),
      messages: {
        updateHost: t("addTranscripts.status.updateHost"),
        unavailable: t("addTranscripts.status.unavailable"),
        exportFailed: t("addTranscripts.status.exportFailed"),
        totalTooLarge: t("addTranscripts.status.totalTooLarge"),
        maximumSelected: t("addTranscripts.status.maximumSelected", {
          count: MAX_TRANSCRIPT_ATTACHMENTS,
        }),
        attachmentTitle: (title) => t("addTranscripts.attachmentTitle", { title }),
      },
    });
    for (const attachment of result.attachments) {
      onAddTranscript(attachment);
    }

    dispatchPicker({
      type: "finish_add",
      errorsBySource: result.errorsBySource,
      successfulKeys: result.successfulKeys,
    });
    if (Object.keys(result.errorsBySource).length === 0) {
      onClose();
    }
  }, [existingAttachments, isAdding, onAddTranscript, onClose, selectedSources, t]);

  const handleAddPress = useCallback(() => {
    void handleAdd();
  }, [handleAdd]);
  const refreshHistory = history.refreshAll;
  const handleRefresh = useCallback(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const hasSources = groups.length > 0;
  const listHeader = useMemo(
    () => (
      <>
        <UnavailableHostsNotice hosts={unavailableHosts} onRefresh={handleRefresh} />
        <SelectionStatus
          isLoading={history.isInitialLoad}
          isError={history.isError}
          hasSources={hasSources}
          hasAnySources={allGroups.length > 0}
          hasQuery={query.trim().length > 0}
          hasUnavailableHosts={unavailableHosts.length > 0}
          onRefresh={handleRefresh}
        />
        {selectionError ? (
          <Text style={styles.selectionError} accessibilityLiveRegion="polite">
            {selectionError}
          </Text>
        ) : null}
      </>
    ),
    [
      allGroups.length,
      handleRefresh,
      hasSources,
      history.isError,
      history.isInitialLoad,
      query,
      selectionError,
      unavailableHosts,
    ],
  );
  const listFooter = useMemo(
    () =>
      history.hasMore ? (
        <View style={styles.loadMoreRow}>
          <Button
            size="sm"
            variant="ghost"
            onPress={history.loadMore}
            loading={history.isLoadingMore}
            disabled={history.isLoadingMore}
          >
            {t("addTranscripts.actions.loadMore")}
          </Button>
        </View>
      ) : null,
    [history.hasMore, history.isLoadingMore, history.loadMore, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t("addTranscripts.selection.count", { count: selectedSources.length })}
        </Text>
        <Button
          variant="default"
          onPress={handleAddPress}
          disabled={selectedSources.length === 0 || isAdding}
          loading={isAdding}
          testID="add-transcripts-confirm"
        >
          {isAdding ? t("addTranscripts.actions.adding") : t("addTranscripts.actions.add")}
        </Button>
      </View>
    ),
    [handleAddPress, isAdding, selectedSources.length, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleClose}
      dismissible={!isAdding}
      header={header}
      footer={footer}
      testID="add-transcripts-sheet"
      desktopMaxWidth={600}
      snapPoints={TRANSCRIPT_SHEET_SNAP_POINTS}
      scrollable={!useVirtualizedList}
    >
      <TranscriptPickerList
        groups={groups}
        selection={selection}
        errorsBySource={errorsBySource}
        sourceSupportsTranscriptExport={sourceSupportsTranscriptExport}
        isAdding={isAdding}
        onToggleSource={handleToggleSource}
        virtualized={useVirtualizedList}
        header={listHeader}
        footer={listFooter}
      />
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  list: {
    gap: theme.spacing[4],
  },
  virtualizedList: {
    flex: 1,
  },
  virtualizedListContent: {
    paddingBottom: theme.spacing[6],
  },
  listHeader: {
    gap: theme.spacing[4],
  },
  listFooter: {
    paddingTop: theme.spacing[2],
  },
  group: {
    gap: theme.spacing[1],
  },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing[2],
  },
  virtualizedGroupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowDisabled: {
    opacity: theme.opacity[50],
  },
  selectionControl: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.sm,
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  selectionControlSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowNotice: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    flex: 1,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyStateTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  selectionError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  footerText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  loadMoreRow: {
    alignItems: "center",
    paddingTop: theme.spacing[4],
  },
}));
