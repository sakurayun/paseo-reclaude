import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

interface SidebarResizeHandleProps {
  edge: "left" | "right";
  gesture: GestureType;
  testID: string;
}

const HIGHLIGHT_DELAY_MS = 100;

const webResizeCursorStyle = isWeb
  ? ({
      cursor: "col-resize",
    } as object)
  : null;

export function SidebarResizeHandle({ edge, gesture, testID }: SidebarResizeHandleProps) {
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hitAreaStyle =
    edge === "left"
      ? [styles.hitArea, styles.leftEdge, webResizeCursorStyle]
      : [styles.hitArea, styles.rightEdge, webResizeCursorStyle];

  const cancelHighlightTimer = useCallback(() => {
    if (highlightTimerRef.current === null) return;
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
  }, []);

  const handleHoverIn = useCallback(() => {
    cancelHighlightTimer();
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlighted(true);
    }, HIGHLIGHT_DELAY_MS);
  }, [cancelHighlightTimer]);

  const handleHoverOut = useCallback(() => {
    cancelHighlightTimer();
    setHighlighted(false);
  }, [cancelHighlightTimer]);

  useEffect(() => cancelHighlightTimer, [cancelHighlightTimer]);

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        testID={testID}
        style={hitAreaStyle}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
      >
        {highlighted ? (
          <View pointerEvents="none" testID={`${testID}-highlight`} style={styles.highlight} />
        ) : null}
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  hitArea: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  leftEdge: {
    left: -5,
  },
  rightEdge: {
    right: -5,
  },
  // Hover affordance without a hard vertical rule: a soft tint over the hit
  // strip only. A 1px foreground line read as a permanent divider and looked
  // harsh against the new-theme shell.
  highlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.foreground,
    opacity: 0.06,
  },
}));
