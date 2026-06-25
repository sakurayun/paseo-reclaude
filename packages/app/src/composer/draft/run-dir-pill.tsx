import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FolderOpen } from "lucide-react-native";
import type { ProjectPickerTriggerArgs } from "@/components/project-picker/project-picker";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedFolderIcon = withUnistyles(FolderOpen);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Last path segment of an absolute dir — the folder name shown on the pill. */
function basename(path: string | null): string {
  if (!path) {
    return "";
  }
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

type ComposerRunDirTriggerProps = ProjectPickerTriggerArgs & {
  /** Current working directory; labels the trigger when no project is selected. */
  runDir: string | null;
};

/**
 * Frosted-glass trigger for the draft composer's working-directory selector.
 * Rendered as the {@link ProjectPicker} trigger so it keeps the glass pill look
 * (matching the import pill) while the dropdown reuses the shared project picker.
 * Sits beside the import pill at the top of the draft composer; the label is the
 * selected project name, falling back to the current run dir's folder name.
 */
export function ComposerRunDirTrigger({
  ref,
  onPress,
  disabled,
  selectedProject,
  runDir,
}: ComposerRunDirTriggerProps) {
  const { t } = useTranslation();
  const label = selectedProject?.projectName || basename(runDir) || t("composer.runDir.select");
  const accessibilityLabel = runDir
    ? `${t("composer.runDir.select")}: ${runDir}`
    : t("composer.runDir.select");
  const bodyStyle = useCallback(
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.body,
      (Boolean(hovered) || pressed) && styles.bodyHovered,
    ],
    [],
  );
  return (
    <View style={styles.row}>
      <Pressable
        ref={ref}
        testID="composer-run-dir-pill"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        disabled={disabled}
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
    // Match the composer input's frosted-glass surface: large radius, no border,
    // translucent glass background with backdrop blur (web) and a soft shadow.
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: isWeb ? theme.colors.surfaceGlass : theme.colors.surfaceGlassStrong,
    maxWidth: 220,
    ...(isWeb
      ? ({
          backdropFilter: "blur(20px) saturate(1.5)",
          WebkitBackdropFilter: "blur(20px) saturate(1.5)",
          boxShadow: "0 3px 18px rgba(0, 0, 0, 0.14)",
        } as object)
      : {
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.16,
          shadowRadius: 12,
          elevation: 5,
        }),
  },
  bodyHovered: {
    backgroundColor: theme.colors.surfaceGlassStrong,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
}));
