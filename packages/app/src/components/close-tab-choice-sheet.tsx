import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";

/**
 * Which tab is awaiting a close decision. Agents choose between "close the
 * tab" (layout-only) and "archive the session"; terminals choose between
 * "close the tab" (terminal keeps running) and "close the terminal for good"
 * (killed; still findable in closed-terminal history).
 */
export type CloseTabChoicePrompt =
  | { kind: "agent"; tabId: string; agentId: string }
  | { kind: "terminal"; tabId: string; terminalId: string };

export function CloseTabChoiceSheet({
  prompt,
  onClose,
  onCloseTabOnly,
  onArchiveAgent,
  onKillTerminal,
}: {
  prompt: CloseTabChoicePrompt | null;
  onClose: () => void;
  onCloseTabOnly: (prompt: CloseTabChoicePrompt) => void;
  onArchiveAgent: (prompt: Extract<CloseTabChoicePrompt, { kind: "agent" }>) => void;
  onKillTerminal: (prompt: Extract<CloseTabChoicePrompt, { kind: "terminal" }>) => void;
}) {
  const { t } = useTranslation();
  const isTerminal = prompt?.kind === "terminal";
  const header = useMemo<SheetHeader>(
    () => ({
      title: isTerminal
        ? t("workspace.tabs.closePrompt.terminalTitle")
        : t("workspace.tabs.closePrompt.agentTitle"),
    }),
    [isTerminal, t],
  );

  const handleCloseTabOnly = useCallback(() => {
    if (prompt) {
      onCloseTabOnly(prompt);
    }
  }, [onCloseTabOnly, prompt]);
  const handleArchiveAgent = useCallback(() => {
    if (prompt?.kind === "agent") {
      onArchiveAgent(prompt);
    }
  }, [onArchiveAgent, prompt]);
  const handleKillTerminal = useCallback(() => {
    if (prompt?.kind === "terminal") {
      onKillTerminal(prompt);
    }
  }, [onKillTerminal, prompt]);
  const killTextStyle = useMemo(() => [styles.optionText, styles.optionTextDestructive], []);

  if (!prompt) {
    return null;
  }

  return (
    <AdaptiveModalSheet header={header} visible onClose={onClose} testID="close-tab-choice-sheet">
      <Pressable
        style={styles.option}
        onPress={handleCloseTabOnly}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.closePrompt.closeTabLabel")}
        testID="close-tab-choice-close-tab"
      >
        <View style={styles.optionBody}>
          <Text style={styles.optionText}>{t("workspace.tabs.closePrompt.closeTabLabel")}</Text>
          <Text style={styles.optionSubtext}>
            {isTerminal
              ? t("workspace.tabs.closePrompt.closeTabTerminalDescription")
              : t("workspace.tabs.closePrompt.closeTabAgentDescription")}
          </Text>
        </View>
      </Pressable>
      {prompt.kind === "agent" ? (
        <Pressable
          style={styles.option}
          onPress={handleArchiveAgent}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.tabs.closePrompt.archiveAgentLabel")}
          testID="close-tab-choice-archive"
        >
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>
              {t("workspace.tabs.closePrompt.archiveAgentLabel")}
            </Text>
            <Text style={styles.optionSubtext}>
              {t("workspace.tabs.closePrompt.archiveAgentDescription")}
            </Text>
          </View>
        </Pressable>
      ) : (
        <Pressable
          style={styles.option}
          onPress={handleKillTerminal}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.tabs.closePrompt.killTerminalLabel")}
          testID="close-tab-choice-kill-terminal"
        >
          <View style={styles.optionBody}>
            <Text style={killTextStyle}>{t("workspace.tabs.closePrompt.killTerminalLabel")}</Text>
            <Text style={styles.optionSubtext}>
              {t("workspace.tabs.closePrompt.killTerminalDescription")}
            </Text>
          </View>
        </Pressable>
      )}
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
  optionBody: {
    flex: 1,
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionTextDestructive: {
    color: theme.colors.palette.red[500],
  },
  optionSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
