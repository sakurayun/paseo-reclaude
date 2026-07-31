import { useCallback, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import type { ChatSelectionBubbleProps } from "./types";

// Vertical gap between the selection's top edge and the bubble.
const GAP = 8;

function preventDefault(event: { preventDefault: () => void }): void {
  // Keeps the text selection alive through the click so the captured text
  // (and the bubble itself) survives pressing a button.
  event.preventDefault();
}

/**
 * Floating bubble shown above a chat text selection with three actions. Web-only
 * — it reads DOM selection coordinates and portals to `document.body` so its
 * `position: fixed` is viewport-relative (escaping the stream's transformed
 * ancestors).
 */
export function ChatSelectionBubble({
  selection,
  onAsk,
  onAskInNewWindow,
  onSavePreset,
}: ChatSelectionBubbleProps) {
  const { t } = useTranslation();
  const rect = selection?.rect ?? null;
  const positionStyle = useMemo<CSSProperties | null>(() => {
    if (!rect) {
      return null;
    }
    return {
      position: "fixed",
      left: rect.left + rect.width / 2,
      top: Math.max(GAP, rect.top - GAP),
      transform: "translate(-50%, -100%)",
      zIndex: 1000,
    };
  }, [rect]);

  const text = selection?.text ?? "";
  const handleAsk = useCallback(() => onAsk(text), [onAsk, text]);
  const handleAskNew = useCallback(() => onAskInNewWindow(text), [onAskInNewWindow, text]);
  const handleSave = useCallback(() => onSavePreset(text), [onSavePreset, text]);

  if (!selection || !positionStyle || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div style={positionStyle} onMouseDown={preventDefault}>
      <View style={styles.bubble} testID="chat-selection-bubble">
        <BubbleButton
          label={t("composer.selection.ask")}
          onPress={handleAsk}
          testID="chat-selection-ask"
        />
        <View style={styles.divider} />
        <BubbleButton
          label={t("composer.selection.askInNewWindow")}
          onPress={handleAskNew}
          testID="chat-selection-ask-new-window"
        />
        <View style={styles.divider} />
        <BubbleButton
          label={t("composer.selection.savePreset")}
          onPress={handleSave}
          testID="chat-selection-save-preset"
        />
      </View>
    </div>,
    document.body,
  );
}

function BubbleButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      Boolean(hovered) && styles.buttonHovered,
    ],
    [],
  );
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" testID={testID}>
      <Text style={styles.buttonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  bubble: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surface1,
    // borderless card (new theme)
    ...theme.shadow.sm,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18)",
  },
  button: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  buttonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  divider: {
    width: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
})) as unknown as Record<string, object>;
