import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import type { EnumeratedDrop } from "@/terminal/drop/enumerate-dropped-entries";

export function formatByteSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface SshUploadDropSheetProps {
  visible: boolean;
  hostLabel: string;
  // Pre-escaped local paths for the paste option; null on pure web where the
  // real filesystem paths are unavailable.
  pasteText: string | null;
  // Null while the dropped directories are still being scanned.
  enumerated: EnumeratedDrop | null;
  canUpload: boolean;
  uploadDisabledReason: string | null;
  initialDestDir: string;
  error: string | null;
  busy: boolean;
  onChangeDestDir: (destDir: string) => void;
  onPaste: () => void;
  onUpload: () => void;
  onClose: () => void;
}

// Drop-choice sheet for SSH terminals: paste the local paths into the shell,
// or upload the dropped files/folders to the remote host over SFTP.
export function SshUploadDropSheet({
  visible,
  hostLabel,
  pasteText,
  enumerated,
  canUpload,
  uploadDisabledReason,
  initialDestDir,
  error,
  busy,
  onChangeDestDir,
  onPaste,
  onUpload,
  onClose,
}: SshUploadDropSheetProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("ssh.uploads.dropSheet.title", { host: hostLabel }) }),
    [hostLabel, t],
  );

  const fileCount = enumerated?.files.length ?? null;
  const uploadReady = canUpload && fileCount !== null && fileCount > 0 && !busy;
  const uploadLabel =
    fileCount === null
      ? t("ssh.uploads.dropSheet.scanning")
      : t("ssh.uploads.dropSheet.uploadAll", { count: fileCount });
  const uploadDescription = useMemo(() => {
    if (uploadDisabledReason) {
      return uploadDisabledReason;
    }
    if (enumerated === null) {
      return t("ssh.uploads.dropSheet.scanningDescription");
    }
    if (enumerated.files.length === 0) {
      return t("ssh.uploads.dropSheet.nothingToUpload");
    }
    const size = formatByteSize(enumerated.totalSize);
    return enumerated.truncated
      ? t("ssh.uploads.dropSheet.uploadDescriptionTruncated", { size })
      : t("ssh.uploads.dropSheet.uploadDescription", { size });
  }, [enumerated, t, uploadDisabledReason]);

  const handleUpload = useCallback(() => {
    if (uploadReady) {
      onUpload();
    }
  }, [onUpload, uploadReady]);
  const uploadOptionStyle = useMemo(
    () => [styles.option, uploadReady ? null : styles.optionDisabled],
    [uploadReady],
  );

  if (!visible) {
    return null;
  }

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="ssh-upload-drop-sheet">
      {pasteText !== null ? (
        <Pressable
          style={styles.option}
          onPress={onPaste}
          accessibilityRole="button"
          accessibilityLabel={t("ssh.uploads.dropSheet.pastePaths")}
          testID="ssh-upload-drop-paste"
        >
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>{t("ssh.uploads.dropSheet.pastePaths")}</Text>
            <Text style={styles.optionSubtext} numberOfLines={2}>
              {t("ssh.uploads.dropSheet.pastePathsDescription")}
            </Text>
          </View>
        </Pressable>
      ) : null}
      <Pressable
        style={uploadOptionStyle}
        onPress={handleUpload}
        disabled={!uploadReady}
        accessibilityRole="button"
        accessibilityLabel={uploadLabel}
        testID="ssh-upload-drop-upload"
      >
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{uploadLabel}</Text>
          <Text style={styles.optionSubtext} numberOfLines={2}>
            {uploadDescription}
          </Text>
        </View>
      </Pressable>
      {canUpload ? (
        <View style={styles.destSection}>
          <Text style={styles.destLabel}>{t("ssh.uploads.dropSheet.destDirLabel")}</Text>
          <AdaptiveTextInput
            initialValue={initialDestDir}
            onChangeText={onChangeDestDir}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="~"
            style={styles.destInput}
            testID="ssh-upload-drop-dest"
          />
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    // borderless card (new theme)
    ...theme.shadow.sm,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionBody: {
    flex: 1,
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  destSection: {
    gap: theme.spacing[2],
  },
  destLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  destInput: {
    // borderless card (new theme)
    ...theme.shadow.sm,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.base,
    backgroundColor: theme.colors.surface1,
  },
  errorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
}));
