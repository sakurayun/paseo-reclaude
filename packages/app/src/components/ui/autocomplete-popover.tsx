import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Keyboard, Platform, StatusBar, View, type LayoutChangeEvent } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

interface AutocompletePopoverProps {
  visible: boolean;
  anchorRef: React.RefObject<View | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
}: AutocompletePopoverProps): ReactElement | null {
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const insets = useSafeAreaInsets();

  const { height: rawKeyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInsetSV = useSharedValue(insets.bottom);
  useEffect(() => {
    bottomInsetSV.value = insets.bottom;
  }, [bottomInsetSV, insets.bottom]);

  // Same shift formula as useKeyboardShiftStyle({mode: "translate"}), so the popover
  // tracks the composer's keyboard translate in lockstep.
  const shift = useDerivedValue(() =>
    Math.max(0, Math.abs(rawKeyboardHeight.value) - bottomInsetSV.value),
  );
  // Snapshot of `shift` at the moment we measured the anchor. Translate applied to the
  // popover is `openShift - shift`, so when shift == openShift the popover sits at the
  // measured position; when keyboard moves the popover translates with the composer.
  const openShift = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      setAnchorRect(null);
      setContentSize(null);
      return;
    }
    let cancelled = false;
    // measureInWindow on Android returns coords below the status bar, while the Portal
    // overlay starts at the top of the window. Mirror tooltip.tsx and shift the rect
    // down by the status bar height to keep both in the same coord system.
    const statusBarOffset = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
    const remeasure = () => {
      const element = anchorRef.current;
      if (!element) return;
      void measureElement(element).then((rect) => {
        if (cancelled) return undefined;
        setAnchorRect({ ...rect, y: rect.y + statusBarOffset });
        openShift.value = shift.value;
        return undefined;
      });
    };

    remeasure();
    const subscriptions = (["keyboardDidShow", "keyboardDidHide"] as const).map((event) =>
      Keyboard.addListener(event, () => requestAnimationFrame(remeasure)),
    );

    return () => {
      cancelled = true;
      for (const sub of subscriptions) sub.remove();
    };
  }, [visible, anchorRef, openShift, shift]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContentSize({ width, height });
  }, []);

  const baseStyle = useMemo(() => {
    if (!anchorRect) return null;
    if (!contentSize) {
      // Have the anchor, waiting on the popover's own height. Render with the
      // final width so the inner Autocomplete lays out at its final size, but
      // stay invisible — the first visible paint will already be at the correct
      // top. Mirrors combobox.tsx `shouldHideDesktopContent`. See
      // docs/floating-panels.md "the two-measurement flash".
      return inlineUnistylesStyle({
        position: "absolute" as const,
        top: 0,
        left: anchorRect.x,
        width: anchorRect.width,
        opacity: 0,
      });
    }
    return inlineUnistylesStyle({
      position: "absolute" as const,
      top: anchorRect.y - contentSize.height - OFFSET_FROM_ANCHOR,
      left: anchorRect.x,
      width: anchorRect.width,
    });
  }, [anchorRect, contentSize]);

  const animatedTransformStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: openShift.value - shift.value }],
  }));

  const composedStyle = useMemo(
    () => [baseStyle, animatedTransformStyle],
    [baseStyle, animatedTransformStyle],
  );

  if (!visible || !anchorRect || !baseStyle) return null;

  return (
    <Portal>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View style={composedStyle} onLayout={handleLayout}>
          <Autocomplete
            options={options}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
          />
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create(() => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
}));
