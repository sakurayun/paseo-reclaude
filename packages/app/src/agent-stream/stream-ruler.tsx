import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import type { RulerMark, RulerMarkKind } from "./ruler-marks";
import { getStreamItemElementId } from "./stream-item-element-id";

export interface StreamRulerProps {
  marks: ReadonlyArray<RulerMark>;
  onPressMark: (mark: RulerMark) => void;
}

const TICK_STYLE_BY_KIND: Record<
  RulerMarkKind,
  "tickUser" | "tickTurnEnd" | "tickNotification" | "tickTodo"
> = {
  user: "tickUser",
  "turn-end": "tickTurnEnd",
  notification: "tickNotification",
  todo: "tickTodo",
};

/**
 * Resolves which mark the viewport is currently scrolled to: the last mark
 * whose stream row sits above the pane's upper third. Rows virtualized out of
 * the DOM are skipped — only marks near the viewport need to win.
 */
function resolveActiveMarkId(host: HTMLElement, marks: ReadonlyArray<RulerMark>): string | null {
  const pane = host.parentElement;
  if (!pane) {
    return null;
  }
  const paneRect = pane.getBoundingClientRect();
  const activationLine = paneRect.top + paneRect.height * 0.33;

  let activeId: string | null = null;
  let firstVisibleId: string | null = null;
  for (const mark of marks) {
    const row = document.getElementById(getStreamItemElementId(mark.id));
    if (!row || !pane.contains(row)) {
      continue;
    }
    const top = row.getBoundingClientRect().top;
    if (firstVisibleId === null) {
      firstVisibleId = mark.id;
    }
    if (top <= activationLine) {
      activeId = mark.id;
    }
  }
  return activeId ?? firstVisibleId;
}

function useActiveMarkId(
  hostRef: React.RefObject<HTMLElement | null>,
  marks: ReadonlyArray<RulerMark>,
): string | null {
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWeb) {
      return;
    }
    let frame: number | null = null;

    const recompute = () => {
      frame = null;
      const host = hostRef.current;
      if (!host) {
        return;
      }
      setActiveMarkId(resolveActiveMarkId(host, marks));
    };

    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(recompute);
    };

    // Scroll events don't bubble, but they are observable in the capture
    // phase; filtering by containment keeps this scoped to our own pane and
    // resilient to the scroll container being swapped by the virtualizer.
    const handleScroll = (event: Event) => {
      const host = hostRef.current;
      const pane = host?.parentElement;
      if (!pane || !(event.target instanceof Node) || !pane.contains(event.target)) {
        return;
      }
      schedule();
    };

    schedule();
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [hostRef, marks]);

  return activeMarkId;
}

function RulerRow({
  mark,
  expanded,
  active,
  onPress,
}: {
  mark: RulerMark;
  expanded: boolean;
  active: boolean;
  onPress: (mark: RulerMark) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    onPress(mark);
  }, [mark, onPress]);

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      expanded && (Boolean(hovered) || pressed) && styles.rowHovered,
    ],
    [expanded],
  );

  const tickStyle = useMemo(
    () => [styles[TICK_STYLE_BY_KIND[mark.kind]], active && styles.tickActive],
    [active, mark.kind],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={!expanded}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={mark.label}
      testID={`stream-ruler-mark-${mark.id}`}
    >
      <View style={styles.tickSlot}>
        <View style={tickStyle} />
      </View>
      {expanded && mark.label ? (
        <Text
          style={mark.kind === "user" ? styles.rowLabelUser : styles.rowLabel}
          numberOfLines={1}
        >
          {mark.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * A ruler-like outline floated over the left edge of the message stream.
 * Collapsed it shows only tick marks; hovering expands it into a frosted
 * panel with one labelled, clickable row per mark. Hover is web-only, so
 * the whole component is web-only.
 */
export function StreamRuler({ marks, onPressMark }: StreamRulerProps): ReactElement | null {
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const hostRef = useRef<HTMLElement | null>(null);
  const activeMarkId = useActiveMarkId(hostRef, marks);
  const surfaceStyle = useMemo(
    () => [styles.surface, hovered && styles.surfaceExpanded],
    [hovered],
  );

  if (!isWeb || marks.length === 0) {
    return null;
  }

  return (
    <View
      ref={hostRef as unknown as React.Ref<View>}
      style={styles.container}
      pointerEvents="box-none"
      testID="stream-ruler"
    >
      <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
        <View style={surfaceStyle}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {marks.map((mark) => (
              <RulerRow
                key={`${mark.kind}:${mark.id}`}
                mark={mark}
                expanded={hovered}
                active={mark.id === activeMarkId}
                onPress={onPressMark}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: 0,
    top: theme.spacing[2],
    bottom: 0,
    justifyContent: "flex-start",
    zIndex: 10,
  },
  surface: {
    maxHeight: "100%",
    borderRadius: theme.borderRadius.xl,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: 0,
  },
  surfaceExpanded: {
    width: 280,
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surfaceGlass,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    // Frosted glass; web-only CSS, and this component only renders on web.
    ...(isWeb
      ? ({
          backdropFilter: "blur(14px) saturate(1.5)",
          WebkitBackdropFilter: "blur(14px) saturate(1.5)",
        } as object)
      : {}),
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 480,
  },
  scrollContent: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tickSlot: {
    width: 14,
    alignItems: "flex-start",
    justifyContent: "center",
    flexShrink: 0,
  },
  tickUser: {
    width: 10,
    height: 1,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.55,
  },
  tickTurnEnd: {
    width: 14,
    height: 1,
    backgroundColor: theme.colors.statusSuccess,
    opacity: 0.5,
  },
  tickNotification: {
    width: 5,
    height: 1,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.35,
  },
  tickTodo: {
    width: 7,
    height: 1,
    backgroundColor: theme.colors.statusWarning,
    opacity: 0.5,
  },
  tickActive: {
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accentBright,
    opacity: 1,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  rowLabelUser: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
}));
