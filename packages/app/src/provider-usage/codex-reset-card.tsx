import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { PressableStateCallbackType, StyleProp, TextStyle, ViewStyle } from "react-native";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useCodexRateLimitStore } from "@/stores/codex-rate-limit-store";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useProviderUsage } from "./use-provider-usage";
import { ProviderUsageWindowBar } from "./window-bar";

// COMPAT(codexRateLimitReset): the usage-limit reset card shown at the end of a
// Codex agent's stream after a rate-limit failure. Reads Codex usage from the
// app-server-backed provider.usage.list and lets the user spend one earned reset
// credit (with confirmation). Disabled when the host lacks the capability or the
// account has no credits.
interface CodexResetCardProps {
  serverId: string;
  agentId: string;
}

export function CodexResetCard({ serverId, agentId }: CodexResetCardProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const supportsReset = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.codexRateLimitReset === true,
  );
  const setHit = useCodexRateLimitStore((state) => state.setHit);
  const { view, refresh } = useProviderUsage(serverId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const codex = useMemo(() => {
    if (view.kind !== "ready") return undefined;
    return view.payload.providers.find((provider) => provider.providerId === "codex");
  }, [view]);

  const windows = codex?.windows ?? [];
  const availableResets = codex?.availableResetCredits ?? 0;
  const canConsume = supportsReset && availableResets > 0 && !busy && client != null;

  const handleConsume = useCallback(async () => {
    if (!client || !canConsume) return;
    const confirmed = await confirmDialog({
      title: t("providerUsage.codexReset.confirmTitle"),
      message: t("providerUsage.codexReset.confirmMessage"),
      confirmLabel: t("providerUsage.codexReset.confirmCta"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setResult(null);
    try {
      const payload = await client.consumeCodexResetCredit();
      switch (payload.outcome) {
        case "reset":
          // Limit lifted — hide the card and refresh the shared usage snapshot.
          setHit(serverId, agentId, false);
          await refresh();
          break;
        case "noCredit":
          setResult(t("providerUsage.codexReset.resultNoCredit"));
          await refresh();
          break;
        case "nothingToReset":
          setResult(t("providerUsage.codexReset.resultNothing"));
          await refresh();
          break;
        default:
          setResult(t("providerUsage.codexReset.resultUnavailable"));
          break;
      }
    } catch {
      setResult(t("providerUsage.codexReset.resultUnavailable"));
    } finally {
      setBusy(false);
    }
  }, [agentId, canConsume, client, refresh, serverId, setHit, t]);

  const buttonLabel = supportsReset
    ? t("providerUsage.codexReset.consume")
    : t("providerUsage.codexReset.upgradeRequired");

  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
      styles.consumeButton,
      !canConsume && styles.consumeButtonDisabled,
      pressed && canConsume && styles.consumeButtonPressed,
    ],
    [canConsume],
  );
  const consumeTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.consumeText, !canConsume && styles.consumeTextDisabled],
    [canConsume],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("providerUsage.codexReset.title")}</Text>
      <Text style={styles.description}>{t("providerUsage.codexReset.description")}</Text>
      {windows.length > 0 ? (
        <View style={styles.windows}>
          {windows.map((window) => (
            <ProviderUsageWindowBar key={window.id} window={window} />
          ))}
        </View>
      ) : null}
      {result ? <Text style={styles.result}>{result}</Text> : null}
      <View style={styles.footer}>
        <Pressable onPress={handleConsume} disabled={!canConsume} style={buttonStyle}>
          <Text style={consumeTextStyle}>{buttonLabel}</Text>
        </Pressable>
        <View style={styles.remainingBadge}>
          <Text style={styles.remainingText}>
            {t("providerUsage.codexReset.remaining", { count: availableResets })}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[3],
    ...theme.shadow.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  windows: {
    gap: theme.spacing[2],
  },
  result: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  consumeButton: {
    flexShrink: 1,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  consumeButtonDisabled: {
    opacity: 0.5,
  },
  consumeButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
  consumeText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  consumeTextDisabled: {
    color: theme.colors.foregroundMuted,
  },
  remainingBadge: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  remainingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
}));
