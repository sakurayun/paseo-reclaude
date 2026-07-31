import { useCallback, useMemo, useRef } from "react";
import { View, type PointerEvent as RNPointerEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";

export interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  groupId: string;
  index: number;
  sizes: number[];
  onResizeSplit: (groupId: string, sizes: number[]) => void;
}

interface PointerState {
  containerSize: number;
  pointerStart: number;
}

function resetWindowHorizontalScroll() {
  // Clamp any browser scroll introduced while dragging past the viewport edge.
  if (window.scrollX === 0) {
    return;
  }
  window.scrollTo(0, window.scrollY);
}

export function ResizeHandle({
  direction,
  groupId,
  index,
  sizes,
  onResizeSplit,
}: ResizeHandleProps) {
  const pointerStatesRef = useRef(new Map<number, PointerState>());
  const cursorBeforeDragRef = useRef<string | null>(null);

  const handlePointerDown = useCallback(
    (event: RNPointerEvent) => {
      const hitAreaElement = event.currentTarget as unknown as HTMLElement | null;
      if (!hitAreaElement) {
        return;
      }

      const containerElement = hitAreaElement.parentElement?.parentElement ?? null;
      if (!containerElement) {
        return;
      }

      const rect = containerElement.getBoundingClientRect();
      const containerSize = direction === "horizontal" ? rect.width : rect.height;
      if (containerSize <= 0) {
        return;
      }

      const pointerId = event.nativeEvent.pointerId;
      if (pointerStatesRef.current.has(pointerId)) {
        return;
      }

      pointerStatesRef.current.set(pointerId, {
        containerSize,
        pointerStart:
          direction === "horizontal" ? event.nativeEvent.clientX : event.nativeEvent.clientY,
      });

      if (pointerStatesRef.current.size === 1) {
        cursorBeforeDragRef.current = document.body.style.cursor;
      }
      const nextCursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.cursor = nextCursor;
      event.preventDefault();
      event.stopPropagation();
      const pointerCaptureElement = hitAreaElement;
      pointerCaptureElement.setPointerCapture?.(pointerId);
      resetWindowHorizontalScroll();

      function cleanup() {
        pointerStatesRef.current.delete(pointerId);
        if (pointerStatesRef.current.size === 0) {
          document.body.style.cursor = cursorBeforeDragRef.current ?? "";
          cursorBeforeDragRef.current = null;
        }
        if (pointerCaptureElement.hasPointerCapture?.(pointerId)) {
          pointerCaptureElement.releasePointerCapture(pointerId);
        }
        resetWindowHorizontalScroll();
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      }

      function handlePointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }

        const pointerState = pointerStatesRef.current.get(pointerId);
        if (!pointerState) {
          return;
        }

        moveEvent.preventDefault();
        resetWindowHorizontalScroll();
        const pointerCurrent = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const deltaRatio =
          (pointerCurrent - pointerState.pointerStart) / pointerState.containerSize;

        onResizeSplit(
          groupId,
          computeResizeHandleSizes({
            sizes,
            index,
            deltaRatio,
          }),
        );
      }

      function handlePointerUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) {
          return;
        }

        cleanup();
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [direction, groupId, index, onResizeSplit, sizes],
  );

  const handleStyle = useMemo(
    () => [
      styles.handle,
      direction === "horizontal" ? styles.handleHorizontal : styles.handleVertical,
    ],
    [direction],
  );
  const hitAreaStyle = useMemo(
    () => [
      styles.hitArea,
      direction === "horizontal" ? styles.hitAreaHorizontal : styles.hitAreaVertical,
      {
        cursor: direction === "horizontal" ? "col-resize" : "row-resize",
        touchAction: "none",
      } as object,
    ],
    [direction],
  );

  return (
    <View style={handleStyle} pointerEvents="box-none">
      <View
        role="separator"
        aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
        style={hitAreaStyle}
        onPointerDown={handlePointerDown}
      />
    </View>
  );
}

const styles = StyleSheet.create((_theme) => ({
  // Invisible layout anchor: no permanent divider and no hover highlight.
  // Drag-to-resize lives entirely on the wider absolute hit area.
  handle: {
    position: "relative",
    flexShrink: 0,
    backgroundColor: "transparent",
  },
  handleHorizontal: {
    width: 0,
    alignSelf: "stretch",
  },
  handleVertical: {
    height: 0,
    width: "100%",
  },
  hitArea: {
    position: "absolute",
    zIndex: 10,
  },
  hitAreaHorizontal: {
    left: -5,
    top: 0,
    bottom: 0,
    width: 10,
  },
  hitAreaVertical: {
    top: -5,
    left: 0,
    right: 0,
    height: 10,
  },
}));
