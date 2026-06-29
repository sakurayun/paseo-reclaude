import { useCallback, useMemo } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CalendarClock,
  FolderPlus,
  History,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type { Theme } from "@/styles/theme";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface SidebarSessionsToolbarLabels {
  newConversation: string;
  openProject: string;
  history: string;
  schedules: string;
  close: string;
}

interface SidebarSessionsToolbarProps {
  labels: SidebarSessionsToolbarLabels;
  onNewConversation: () => void;
  onOpenProject: () => void;
  onHistory: () => void;
  isHistoryActive?: boolean;
  /** Desktop (Electron) only: render a Schedules action after History. */
  onSchedules?: () => void;
  isSchedulesActive?: boolean;
  /** Compact layout only: render an inline close (X) at the trailing edge. */
  onClose?: () => void;
}

const PRESS_SCALE = 0.96;
const ICON_SIZE = 20;

/**
 * New-theme top toolbar: three evenly distributed actions — new conversation,
 * open project, history — mirroring the classic sidebar's handlers exactly. On
 * compact layouts an inline close button rides at the trailing edge (the
 * classic floating close button is hidden in this layout).
 */
export function SidebarSessionsToolbar({
  labels,
  onNewConversation,
  onOpenProject,
  onHistory,
  isHistoryActive = false,
  onSchedules,
  isSchedulesActive = false,
  onClose,
}: SidebarSessionsToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <ToolbarButton
        icon={SquarePen}
        label={labels.newConversation}
        onPress={onNewConversation}
        index={0}
        testID="sidebar-toolbar-new-conversation"
      />
      <ToolbarButton
        icon={FolderPlus}
        label={labels.openProject}
        onPress={onOpenProject}
        index={1}
        testID="sidebar-toolbar-open-project"
      />
      <ToolbarButton
        icon={History}
        label={labels.history}
        onPress={onHistory}
        isActive={isHistoryActive}
        index={2}
        testID="sidebar-toolbar-history"
      />
      {onSchedules ? (
        <ToolbarButton
          icon={CalendarClock}
          label={labels.schedules}
          onPress={onSchedules}
          isActive={isSchedulesActive}
          index={3}
          testID="sidebar-toolbar-schedules"
        />
      ) : null}
      {onClose ? <CloseButton label={labels.close} onPress={onClose} /> : null}
    </View>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  index,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  index: number;
  testID: string;
}) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const innerStyle = useMemo(() => [a.inner, animatedStyle], [animatedStyle]);

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(PRESS_SCALE, { duration: 90 });
  }, [scale]);
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 18, stiffness: 320, mass: 0.5 });
  }, [scale]);

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed || isActive) && styles.buttonHovered,
    ],
    [isActive],
  );

  // Stagger each action in on mount — a small, fast cascade (~45ms apart) so the
  // toolbar assembles rather than popping in all at once.
  const entering = useMemo(() => FadeInDown.duration(220).delay(index * 45), [index]);

  const labelStyle = useCallback(
    (highlighted: boolean) => [styles.label, highlighted && styles.labelHighlighted],
    [],
  );

  return (
    <Animated.View entering={entering} style={a.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={isActive ? ACTIVE_STATE : undefined}
        testID={testID}
        style={buttonStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {({ hovered, pressed }) => {
          const highlighted = Boolean(hovered) || pressed || isActive;
          return (
            <Animated.View style={innerStyle}>
              <ThemedIcon
                size={ICON_SIZE}
                uniProps={highlighted ? foregroundColorMapping : foregroundMutedColorMapping}
              />
              <Text style={labelStyle(highlighted)} numberOfLines={1}>
                {label}
              </Text>
            </Animated.View>
          );
        }}
      </Pressable>
    </Animated.View>
  );
}

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  const ThemedX = useMemo(() => withUnistyles(X), []);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.closeButton,
      (Boolean(hovered) || pressed) && styles.buttonHovered,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="sidebar-toolbar-close"
      hitSlop={8}
      style={buttonStyle}
      onPress={onPress}
    >
      {({ hovered, pressed }) => (
        <ThemedX
          size={ICON_SIZE}
          uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
        />
      )}
    </Pressable>
  );
}

const ACTIVE_STATE = { selected: true } as const;

// Plain RN styles for the animated press wrapper + flex slots: Unistyles dynamic
// theme styles must not ride on an Animated.View (it crashes the Fabric node
// patch). Theme-aware styling lives on the Pressable/Text below instead.
const a = RNStyleSheet.create({
  slot: {
    flex: 1,
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
});

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
  closeButton: {
    width: 40,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
}));
