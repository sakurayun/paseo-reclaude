import { useCallback, useEffect, useRef, type ReactElement } from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Clock, MessageSquareQuote } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { getAutocompleteScrollOffset } from "@/components/ui/autocomplete-utils";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Shortcut } from "@/components/ui/shortcut";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const ThemedMessageSquareQuote = withUnistyles(MessageSquareQuote);

/** Which list the track renders — drives the header icon, title, and testID. */
export type HistoryTrackVariant = "history" | "presets";

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const HISTORY_LIST_MAX_HEIGHT = 220;

// Stable arrow-key chords for the header switch hint (hoisted so the Shortcut
// prop isn't a new array each render).
const SWITCH_TO_PRESETS_KEYS = ["Right"];
const SWITCH_TO_HISTORY_KEYS = ["Left"];

export interface HistoryTrackProps {
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  /** Header/icon/testID flavor. Defaults to the prompt-history list. */
  variant?: HistoryTrackVariant;
  /**
   * When true, the header shows a hint for the arrow key that switches to the
   * other list (→ to presets from history, ← back to history from presets).
   */
  canSwitch?: boolean;
}

interface HistoryTrackRowProps {
  index: number;
  option: AutocompleteOption;
  isSelected: boolean;
  onSelect: (option: AutocompleteOption) => void;
  onRowLayout: (index: number, event: LayoutChangeEvent) => void;
}

function HistoryTrackRow({
  index,
  option,
  isSelected,
  onSelect,
  onRowLayout,
}: HistoryTrackRowProps): ReactElement {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onRowLayout(index, event),
    [index, onRowLayout],
  );
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed || isSelected) && styles.rowActive,
    ],
    [isSelected],
  );

  return (
    <Pressable onLayout={handleLayout} onPress={handlePress} style={rowStyle}>
      <View style={styles.indexBadge}>
        <Text style={styles.indexBadgeText}>{index + 1}</Text>
      </View>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {option.label}
      </Text>
    </Pressable>
  );
}

/**
 * Inline prompt-history list rendered above the composer input, styled to match
 * the todo track: a frosted-glass card with a top-rounded surface that sits flush
 * against the input, a small header, and a scrollable list whose highlighted row
 * tracks the keyboard selection.
 */
export function HistoryTrack({
  options,
  selectedIndex,
  onSelect,
  variant = "history",
  canSwitch = false,
}: HistoryTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const isPresets = variant === "presets";
  // The switch hint is keyboard-only, so it only makes sense on web.
  const showSwitchHint = isWeb && canSwitch;
  const scrollRef = useRef<ScrollView>(null);
  const rowLayoutsRef = useRef<Map<number, { top: number; height: number }>>(new Map());
  const viewportHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const ensureActiveItemVisible = useCallback(() => {
    if (selectedIndex < 0) return;
    const layout = rowLayoutsRef.current.get(selectedIndex);
    if (!layout) return;
    const nextOffset = getAutocompleteScrollOffset({
      currentOffset: scrollOffsetRef.current,
      viewportHeight: viewportHeightRef.current,
      itemTop: layout.top,
      itemHeight: layout.height,
    });
    if (Math.abs(nextOffset - scrollOffsetRef.current) < 1) return;
    scrollOffsetRef.current = nextOffset;
    scrollRef.current?.scrollTo({ y: nextOffset, animated: false });
  }, [selectedIndex]);

  useEffect(() => {
    rowLayoutsRef.current.clear();
    scrollOffsetRef.current = 0;
  }, [options]);

  useEffect(() => {
    const raf = requestAnimationFrame(ensureActiveItemVisible);
    return () => cancelAnimationFrame(raf);
  }, [ensureActiveItemVisible, options.length]);

  const handleScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleRowLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      rowLayoutsRef.current.set(index, {
        top: event.nativeEvent.layout.y,
        height: event.nativeEvent.layout.height,
      });
      ensureActiveItemVisible();
    },
    [ensureActiveItemVisible],
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <GlassSurface
      backdropStyle={styles.surfaceBackdrop}
      style={styles.surface}
      testID={isPresets ? "composer-presets-track" : "composer-history-track"}
    >
      <View style={styles.header}>
        {isPresets ? (
          <ThemedMessageSquareQuote size={12} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedClock size={12} uniProps={foregroundMutedColorMapping} />
        )}
        <Text style={styles.headerLabel} numberOfLines={1}>
          {t(isPresets ? "composer.promptPresets.title" : "composer.promptHistory.title")}
        </Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{options.length}</Text>
        </View>
        {showSwitchHint ? (
          <View style={styles.switchHint}>
            <Shortcut keys={isPresets ? SWITCH_TO_HISTORY_KEYS : SWITCH_TO_PRESETS_KEYS} />
            <Text style={styles.switchHintText} numberOfLines={1}>
              {t(
                isPresets
                  ? "composer.promptPresets.switchHint"
                  : "composer.promptHistory.switchHint",
              )}
            </Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        onLayout={handleScrollViewLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
      >
        {options.map((option, index) => (
          <HistoryTrackRow
            key={option.id}
            index={index}
            option={option}
            isSelected={index === selectedIndex}
            onSelect={onSelect}
            onRowLayout={handleRowLayout}
          />
        ))}
      </ScrollView>
    </GlassSurface>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  // Frosted-glass card matching the todo track: top-rounded, no bottom border,
  // pulled down to sit flush against the input below.
  surface: {
    alignSelf: "stretch",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    // Bottom padding (corner radius worth) keeps the last row clear of the area
    // that overlaps the input below.
    paddingBottom: theme.spacing[4],
    // Overlap the input's rounded top: cancel inputAreaContent's gap (spacing[3])
    // AND pull down by the input's corner radius (spacing[4] === borderRadius 2xl)
    // so the card's flat bottom edge covers the rounded corners and sits flush,
    // exactly like the todo track sits on the composer.
    marginBottom: -(theme.spacing[3] + theme.spacing[4]),
  },
  surfaceBackdrop: {
    top: theme.borderWidth[1],
    right: theme.borderWidth[1],
    bottom: 0,
    left: theme.borderWidth[1],
    borderTopLeftRadius: theme.borderRadius["2xl"] - theme.borderWidth[1],
    borderTopRightRadius: theme.borderRadius["2xl"] - theme.borderWidth[1],
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  // Rounded-rectangle badge with the total count, sitting at the end of the header.
  countBadge: {
    flexShrink: 0,
    minWidth: 18,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
  },
  // Keyboard hint at the header's right edge: "→ switch to presets" / "← back".
  switchHint: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  switchHintText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    maxHeight: HISTORY_LIST_MAX_HEIGHT,
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
  // Rounded-rectangle badge with the 1-based ordinal, in front of each row.
  // surface3 keeps it visible even on the surface2-highlighted selected row.
  indexBadge: {
    flexShrink: 0,
    minWidth: 22,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  indexBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.foreground,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
})) as unknown as Record<string, object>;
