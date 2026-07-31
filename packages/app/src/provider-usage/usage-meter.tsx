import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MeterRingGlyph, meterVariantFromTone } from "@/components/meter-ring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/use-settings";
import { ProviderUsageCard } from "./card";
import {
  matchProviderUsage,
  resolveMeterDisplayPercentage,
  resolvePrimaryUsage,
} from "./primary-usage";
import { useGrok } from "./use-grok";
import { useGrokUsageAutoSync } from "./use-grok-usage-auto-sync";
import { useProviderUsage } from "./use-provider-usage";
import { useReclaude } from "./use-reclaude";

interface ProviderUsageMeterProps {
  serverId: string;
  /** The Paseo provider key, e.g. "claude", "gemini", "codex", "grok" */
  provider: string | null;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
}

/**
 * Independent plan-usage ring next to the context-window meter.
 * Arc fill and center label follow settings: used % or remaining %.
 * Color tone always tracks risk from used % (high used → danger).
 */
export function ProviderUsageMeter({ serverId, provider, glyphSize }: ProviderUsageMeterProps) {
  const { t } = useTranslation();
  const percentageMode = useAppSettings().settings.providerUsageMeterPercentageMode;
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { view, refresh, canFetch } = useProviderUsage(serverId, { enabled: true });
  const {
    active: reclaudeActive,
    loggedIn: reclaudeLoggedIn,
    syncUsage: syncReclaudeUsage,
  } = useReclaude(serverId);
  const { supported: grokUsageSupported, syncUsage: syncGrokUsage } = useGrok(serverId);

  const isReclaudeClaude = provider === "claude" && reclaudeActive && reclaudeLoggedIn;
  const isGrok = provider === "grok" && grokUsageSupported;

  useGrokUsageAutoSync({ serverId, enabled: isGrok });

  const matchedUsage = useMemo(() => {
    if (view.kind !== "ready" || !provider) return null;
    return matchProviderUsage(view.payload.providers, provider);
  }, [provider, view]);

  const primary = useMemo(
    () => (matchedUsage ? resolvePrimaryUsage(matchedUsage) : null),
    [matchedUsage],
  );

  const handleTooltipOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsTooltipOpen(nextOpen);
      if (!nextOpen) {
        return;
      }
      if (isReclaudeClaude) {
        void syncReclaudeUsage().catch(() => undefined);
      } else if (isGrok) {
        void syncGrokUsage().catch(() => undefined);
      } else {
        void refresh().catch(() => {});
      }
    },
    [isGrok, isReclaudeClaude, refresh, syncGrokUsage, syncReclaudeUsage],
  );

  if (!canFetch || !provider || view.kind === "error") {
    return null;
  }

  // Loading, or Grok waiting on the first auto-sync: reserve the footprint.
  if (view.kind === "loading" || (isGrok && primary == null)) {
    return (
      <View style={styles.trigger} testID="provider-usage-meter">
        <MeterRingGlyph percentage={null} variant="pending" glyphSize={glyphSize} />
      </View>
    );
  }

  if (primary == null) {
    return null;
  }

  const displayPercentage = resolveMeterDisplayPercentage(primary, percentageMode);
  const roundedPercentage = Math.round(displayPercentage);
  // Risk color stays anchored to utilization (used), not the display mode.
  const variant = meterVariantFromTone(primary.tone);
  const accessibilityKey =
    percentageMode === "remaining"
      ? "providerUsage.meter.accessibilityRemaining"
      : "providerUsage.meter.accessibilityUsed";

  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={styles.trigger}
          testID="provider-usage-meter"
          accessibilityRole="image"
          accessibilityLabel={t(accessibilityKey, {
            percentage: roundedPercentage,
          })}
        >
          <MeterRingGlyph percentage={displayPercentage} variant={variant} glyphSize={glyphSize} />
          <Text style={styles.centerLabel} numberOfLines={1}>
            {roundedPercentage}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          {matchedUsage ? <ProviderUsageCard usage={matchedUsage} compact /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  centerLabel: {
    position: "absolute",
    color: theme.colors.foregroundMuted,
    // Stay small inside the 28px ring hit target so 2–3 digit values don't dominate.
    fontSize: 6,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 8,
    textAlign: "center",
    // Tabular-ish alignment so 8 / 88 / 100 don't jump.
    fontVariant: ["tabular-nums"],
  },
  tooltipContent: {
    minWidth: 200,
  },
}));
