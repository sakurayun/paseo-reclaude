import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FolderOpen } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

const ThemedFolderIcon = withUnistyles(FolderOpen);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ComposerRunDirPillProps {
  /** Absolute run directory; the pill shows its last path segment. */
  runDir: string | null;
  onPress: () => void;
  disabled?: boolean;
}

/** Last path segment of an absolute dir — the folder name shown on the pill. */
function basename(path: string | null): string {
  if (!path) {
    return "";
  }
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

/**
 * Picks the working directory the new agent runs in. Sits beside the import pill
 * at the top of the draft composer; the label is the current run dir's folder
 * name so it doubles as a "this is where it runs" indicator.
 */
export function ComposerRunDirPill({ runDir, onPress, disabled = false }: ComposerRunDirPillProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(() => [styles.body, isHovered && styles.bodyHovered], [isHovered]);
  const folderName = basename(runDir);
  const label = folderName || t("composer.runDir.select");
  const accessibilityLabel = runDir
    ? `${t("composer.runDir.select")}: ${runDir}`
    : t("composer.runDir.select");
  return (
    <View style={styles.row}>
      <Pressable
        testID="composer-run-dir-pill"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        disabled={disabled}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={bodyStyle}
      >
        <ThemedFolderIcon size={14} uniProps={iconColorMapping} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    maxWidth: 220,
  },
  bodyHovered: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
}));
