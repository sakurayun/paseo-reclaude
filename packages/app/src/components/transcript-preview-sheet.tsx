import { useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ChatHistoryContextAttachment } from "@/attachments/types";
import { getChatHistoryContextSubtitle } from "@/attachments/chat-history-presentation";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";

const TRANSCRIPT_PREVIEW_SNAP_POINTS = ["65%", "92%"];

interface TranscriptPreviewSheetProps {
  visible: boolean;
  attachment: ChatHistoryContextAttachment | null;
  onClose: () => void;
}

/** Displays the immutable draft-owned snapshot that will be sent to a new agent. */
export function TranscriptPreviewSheet({
  visible,
  attachment,
  onClose,
}: TranscriptPreviewSheetProps) {
  const { t } = useTranslation();
  const title = attachment?.attachment.title ?? t("message.attachments.textAttachment");
  const subtitle = attachment ? getChatHistoryContextSubtitle(attachment, t) : null;
  const header = useMemo<SheetHeader>(
    () => ({
      title,
      subtitle: subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : undefined,
    }),
    [subtitle, title],
  );

  return (
    <AdaptiveModalSheet
      visible={visible && attachment !== null}
      onClose={onClose}
      header={header}
      snapPoints={TRANSCRIPT_PREVIEW_SNAP_POINTS}
      scrollable={false}
      testID="transcript-preview-sheet"
      desktopMaxWidth={760}
    >
      {attachment ? (
        <ScrollableCodeSurface
          maxHeight={520}
          horizontal={false}
          splitLines={false}
          testID="transcript-preview-content"
          accessibilityLabel={title}
        >
          {attachment.attachment.text}
        </ScrollableCodeSurface>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
