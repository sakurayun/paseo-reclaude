import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

interface ComposerAddTranscriptsPillProps {
  onPress: () => void;
  disabled?: boolean;
}

/** Opens the destination-first transcript picker for a New Agent draft. */
export function ComposerAddTranscriptsPill({
  onPress,
  disabled = false,
}: ComposerAddTranscriptsPillProps) {
  const { t } = useTranslation();
  return (
    <Button
      testID="composer-add-transcripts-pill"
      accessibilityLabel={t("addTranscripts.title")}
      variant="outline"
      size="sm"
      leftIcon={MessagesSquare}
      onPress={onPress}
      disabled={disabled}
      style={styles.button}
      textStyle={styles.label}
    >
      {t("addTranscripts.title")}
    </Button>
  );
}

const styles = StyleSheet.create(() => ({
  button: {
    maxWidth: "100%",
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
  },
}));
