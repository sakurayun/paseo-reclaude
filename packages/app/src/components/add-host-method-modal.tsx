import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { isNative } from "@/constants/platform";

const styles = StyleSheet.create((theme) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
  optionBody: {
    flex: 1,
  },
}));

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onScanQr: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onScanQr,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("app");

  const addConnectionHeader = useMemo<SheetHeader>(
    () => ({ title: t("addHost.method.title") }),
    [t],
  );

  const handleDirect = useCallback(() => {
    onDirectConnection();
  }, [onDirectConnection]);

  const handleScan = useCallback(() => {
    onScanQr();
  }, [onScanQr]);

  const handlePaste = useCallback(() => {
    onPasteLink();
  }, [onPasteLink]);

  return (
    <AdaptiveModalSheet
      header={addConnectionHeader}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <Pressable
        style={styles.option}
        onPress={handleDirect}
        accessibilityRole="button"
        accessibilityLabel={t("addHost.method.direct.label")}
        testID="add-host-method-direct"
      >
        <Link2 size={18} color={theme.colors.foreground} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{t("addHost.method.direct.label")}</Text>
          <Text style={styles.optionSubtext}>{t("addHost.method.direct.subtext")}</Text>
        </View>
      </Pressable>

      {isNative ? (
        <Pressable
          style={styles.option}
          onPress={handleScan}
          accessibilityRole="button"
          accessibilityLabel={t("addHost.method.scan.label")}
        >
          <QrCode size={18} color={theme.colors.foreground} />
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>{t("addHost.method.scan.label")}</Text>
            <Text style={styles.optionSubtext}>{t("addHost.method.scan.subtext")}</Text>
          </View>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.option}
        onPress={handlePaste}
        accessibilityRole="button"
        accessibilityLabel={t("addHost.method.pasteLink.label")}
        testID="add-host-method-pair-link"
      >
        <ClipboardPaste size={18} color={theme.colors.foreground} />
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{t("addHost.method.pasteLink.label")}</Text>
          <Text style={styles.optionSubtext}>{t("addHost.method.pasteLink.subtext")}</Text>
        </View>
      </Pressable>
    </AdaptiveModalSheet>
  );
}
