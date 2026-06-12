import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { Bot, Check, ChevronDown, ChevronRight, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { resolveToolCallColor, type ToolCallSchemeColor } from "@/utils/tool-call-colors";
import { selectCurrentRunSidechainCalls, type SidechainCall } from "./sidechain-track-select";
import { ToolCallSheetProvider, useToolCallSheet } from "./tool-call-sheet";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedBot = withUnistyles(Bot);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const successColorMapping = (theme: Theme) => ({
  color: theme.colors.statusSuccess,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

const SIDECHAIN_LIST_MAX_HEIGHT = 200;

const EMPTY_CALLS: SidechainCall[] = [];

export function useCurrentRunSidechainCalls(serverId: string, agentId: string): SidechainCall[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[serverId];
      if (!session) return EMPTY_CALLS;
      const calls = selectCurrentRunSidechainCalls([
        session.agentStreamTail.get(agentId),
        session.agentStreamHead.get(agentId),
      ]);
      return calls.length === 0 ? EMPTY_CALLS : calls;
    },
    equal,
  );
}

function SidechainStatusIcon({ status }: { status: SidechainCall["status"] }): ReactElement {
  if (status === "completed") {
    return <ThemedCheck size={12} uniProps={successColorMapping} />;
  }
  if (status === "failed" || status === "canceled") {
    return <ThemedX size={12} uniProps={destructiveColorMapping} />;
  }
  return <ThemedActivityIndicator size={12} uniProps={foregroundMutedColorMapping} />;
}

const DOUBLE_PRESS_WINDOW_MS = 350;

function stopPressPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

function SidechainTrackRow({
  call,
  onDismiss,
}: {
  call: SidechainCall;
  onDismiss: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { openToolCall } = useToolCallSheet();
  const lastPressAtRef = useRef(0);
  const typeLabel = call.agentType;

  // Pressable has no double-click event on native or web; a timed window
  // covers double-click and double-tap with the same code path.
  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAtRef.current <= DOUBLE_PRESS_WINDOW_MS) {
      lastPressAtRef.current = 0;
      openToolCall({
        displayName: typeLabel,
        summary: call.description || undefined,
        detail: call.detail,
        errorText: call.errorText,
        icon: Bot,
      });
      return;
    }
    lastPressAtRef.current = now;
  }, [call, openToolCall, typeLabel]);

  const handleDismiss = useCallback(() => {
    onDismiss(call.id);
  }, [call.id, onDismiss]);

  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (Boolean(hovered) || pressed) && styles.rowActive,
    ],
    [],
  );

  // Same tint the timeline gives this tool call's label.
  const labelColor = useMemo(
    () => resolveToolCallColor(call.agentType, call.detail),
    [call.agentType, call.detail],
  );
  const rowTypeStyle = useMemo(
    () => [styles.rowType, labelColor ? styles.rowTypeTinted(labelColor) : null],
    [labelColor],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={`${typeLabel} ${call.description}`.trim()}
      testID={`sidechain-track-row-${call.id}`}
    >
      <View style={styles.rowIconSlot}>
        <SidechainStatusIcon status={call.status} />
      </View>
      <Text style={rowTypeStyle} numberOfLines={1}>
        {typeLabel}
      </Text>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {call.description}
      </Text>
      {call.status !== "running" ? (
        <Pressable
          onPressIn={stopPressPropagation}
          onPress={handleDismiss}
          style={closeButtonStyle}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("sidechainTrack.removeEntry")}
          testID={`sidechain-track-row-close-${call.id}`}
        >
          {({ hovered, pressed }) => (
            <ThemedX
              size={12}
              uniProps={
                Boolean(hovered) || pressed ? foregroundColorMapping : foregroundMutedColorMapping
              }
            />
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function closeButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.closeButton, (Boolean(hovered) || pressed) && styles.closeButtonActive];
}

export interface SidechainTrackProps {
  calls: ReadonlyArray<SidechainCall>;
}

/**
 * Pins the current run's sidechain sub-agents (Task tool calls) above the
 * composer so their status stays visible while the agent works — the same
 * collapsible-track pattern as the subagents track and the todo track.
 */
export function SidechainTrack({ calls }: SidechainTrackProps): ReactElement | null {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [panelDismissed, setPanelDismissed] = useState(false);
  const knownIdsRef = useRef<Set<string>>(new Set());

  // New activity (a call id we haven't seen) re-shows a manually closed
  // panel; without this the panel would stay hidden across later runs.
  useEffect(() => {
    let hasNewCall = false;
    for (const call of calls) {
      if (!knownIdsRef.current.has(call.id)) {
        knownIdsRef.current.add(call.id);
        hasNewCall = true;
      }
    }
    if (hasNewCall) {
      setPanelDismissed(false);
    }
  }, [calls]);

  const visibleCalls = useMemo(
    () => calls.filter((call) => !dismissedIds.has(call.id)),
    [calls, dismissedIds],
  );

  const handleDismissPanel = useCallback(() => {
    setPanelDismissed(true);
  }, []);

  const handleDismissCall = useCallback((id: string) => {
    setDismissedIds((previous) => {
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  }, []);

  if (panelDismissed || visibleCalls.length === 0) {
    return null;
  }
  return (
    // Own sheet host: the track lives in the composer area, outside the
    // stream view's ToolCallSheetProvider.
    <ToolCallSheetProvider>
      <SidechainTrackInner
        calls={visibleCalls}
        onDismissPanel={handleDismissPanel}
        onDismissCall={handleDismissCall}
      />
    </ToolCallSheetProvider>
  );
}

function SidechainTrackInner({
  calls,
  onDismissPanel,
  onDismissCall,
}: SidechainTrackProps & {
  onDismissPanel: () => void;
  onDismissCall: (id: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  const surfaceStyle = useMemo(
    () => [styles.surface, expanded && styles.surfaceExpanded],
    [expanded],
  );

  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.header,
      !expanded && styles.headerCollapsed,
      (Boolean(hovered) || pressed) && styles.headerActive,
    ],
    [expanded],
  );

  if (calls.length === 0) {
    return null;
  }

  const runningCount = calls.filter((call) => call.status === "running").length;
  const completedCount = calls.filter((call) => call.status === "completed").length;
  const progressLabel = t("sidechainTrack.header", {
    completed: completedCount,
    total: calls.length,
  });
  const runningCall = calls.find((call) => call.status === "running");
  const headerDetail = runningCall
    ? runningCall.description || runningCall.agentType
    : t("sidechainTrack.allDone");

  return (
    <View style={styles.outer} testID="sidechain-track">
      <View style={styles.track}>
        <View style={surfaceStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={progressLabel}
            testID="sidechain-track-header"
            onPress={toggleExpanded}
            style={headerStyle}
          >
            {expanded ? (
              <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
            )}
            {runningCount > 0 ? (
              <ThemedActivityIndicator size={12} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedBot size={12} uniProps={foregroundMutedColorMapping} />
            )}
            <Text style={styles.headerProgress}>{progressLabel}</Text>
            <Text style={styles.headerLabel} numberOfLines={1}>
              {headerDetail}
            </Text>
            {runningCount === 0 ? (
              <Pressable
                onPressIn={stopPressPropagation}
                onPress={onDismissPanel}
                style={closeButtonStyle}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t("sidechainTrack.closePanel")}
                testID="sidechain-track-close"
              >
                {({ hovered, pressed }) => (
                  <ThemedX
                    size={12}
                    uniProps={
                      Boolean(hovered) || pressed
                        ? foregroundColorMapping
                        : foregroundMutedColorMapping
                    }
                  />
                )}
              </Pressable>
            ) : null}
          </Pressable>
          {expanded ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {calls.map((call) => (
                <SidechainTrackRow key={call.id} call={call} onDismiss={onDismissCall} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: -theme.spacing[4],
  },
  surface: {
    alignSelf: "stretch",
    // Frosted glass like the composer on web; native has no backdrop blur,
    // so it keeps the opaque surface.
    backgroundColor: isWeb ? theme.colors.surfaceGlass : theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...(isWeb
      ? ({
          backdropFilter: "blur(20px) saturate(1.5)",
          WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        } as object)
      : {}),
  },
  surfaceExpanded: {
    paddingBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerCollapsed: {
    paddingBottom: theme.spacing[6],
  },
  headerActive: {
    backgroundColor: theme.colors.surface2,
  },
  headerProgress: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  headerLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  closeButton: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  closeButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  scroll: {
    maxHeight: SIDECHAIN_LIST_MAX_HEIGHT,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowType: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  rowTypeTinted: (tint: ToolCallSchemeColor) => ({
    color: String(rt.themeName).startsWith("light") ? tint.light : tint.dark,
  }),
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
