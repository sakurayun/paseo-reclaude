import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, ListTodo } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import type { TodoEntry } from "@/types/stream";
import { selectLatestTodoItems } from "./todo-track-select";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedListTodo = withUnistyles(ListTodo);
const ThemedCheck = withUnistyles(Check);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const primaryForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.primaryForeground,
});

const TODO_LIST_MAX_HEIGHT = 200;

export function useLatestAgentTodos(serverId: string, agentId: string): TodoEntry[] | null {
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session) return null;
    return selectLatestTodoItems([
      session.agentStreamTail.get(agentId),
      session.agentStreamHead.get(agentId),
    ]);
  });
}

export interface TodoTrackProps {
  items: ReadonlyArray<TodoEntry> | null;
}

export function TodoTrack({ items }: TodoTrackProps): ReactElement | null {
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
      (hovered || pressed) && styles.headerActive,
    ],
    [expanded],
  );

  // Open work first; completed tasks sink to the bottom in their own order.
  const orderedItems = useMemo(() => {
    if (!items) return [];
    return [...items.filter((item) => !item.completed), ...items.filter((item) => item.completed)];
  }, [items]);

  if (!items || items.length === 0) {
    return null;
  }

  const completedCount = items.filter((item) => item.completed).length;
  const currentTask = items.find((item) => !item.completed)?.text;
  const progressLabel = t("todoTrack.header", {
    completed: completedCount,
    total: items.length,
  });
  const headerLabel = currentTask ?? t("todoTrack.allDone");

  return (
    <View style={styles.outer} testID="todo-track">
      <View style={styles.track}>
        <View style={surfaceStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={progressLabel}
            testID="todo-track-header"
            onPress={toggleExpanded}
            style={headerStyle}
          >
            {expanded ? (
              <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
            )}
            <ThemedListTodo size={12} uniProps={foregroundMutedColorMapping} />
            <Text style={styles.headerProgress}>{progressLabel}</Text>
            <Text style={styles.headerLabel} numberOfLines={1}>
              {headerLabel}
            </Text>
          </Pressable>
          {expanded ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {orderedItems.map((item) => (
                <TodoTrackRow key={item.text} text={item.text} completed={item.completed} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function TodoTrackRow({ text, completed }: TodoEntry): ReactElement {
  const badgeStyle = useMemo(
    () => [styles.radioBadge, completed ? styles.radioBadgeComplete : styles.radioBadgeIncomplete],
    [completed],
  );
  const textStyle = useMemo(
    () => [styles.rowLabel, completed && styles.rowLabelCompleted],
    [completed],
  );
  return (
    <View style={styles.row}>
      <View style={badgeStyle}>
        {completed ? <ThemedCheck size={10} uniProps={primaryForegroundColorMapping} /> : null}
      </View>
      <Text style={textStyle} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
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
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  scroll: {
    maxHeight: TODO_LIST_MAX_HEIGHT,
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
  radioBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  radioBadgeIncomplete: {
    opacity: 0.28,
  },
  radioBadgeComplete: {
    opacity: 0.55,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  rowLabelCompleted: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
  },
}));
