import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import { formatTokenCount } from "./context-window-meter.utils";

interface ContextWindowMeterProps {
  maxTokens: number;
  usedTokens: number;
  totalCostUsd?: number | null;
  showPercentage?: boolean;
  serverId?: string;
  selectedModel?: string | null;
  /** The Paseo provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
}

const SVG_SIZE = 16;
const COMPACT_SVG_SIZE = 14;
const CENTER = SVG_SIZE / 2;
const COMPACT_CENTER = COMPACT_SVG_SIZE / 2;
const RADIUS = 7;
const COMPACT_RADIUS = 6;
const STROKE_WIDTH = 2.25;
const COMPACT_STROKE_WIDTH = 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const COMPACT_CIRCUMFERENCE = 2 * Math.PI * COMPACT_RADIUS;

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function getMeterColors(
  percentage: number,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { progress: string; track: string } {
  const track = theme.colors.surface3;
  if (percentage > 90) {
    return { progress: theme.colors.destructive, track };
  }
  if (percentage >= 70) {
    return { progress: theme.colors.palette.amber[500], track };
  }
  return { progress: theme.colors.foregroundMuted, track };
}

function getBarColor(pct: number, theme: ReturnType<typeof useUnistyles>["theme"]): string {
  if (pct > 90) return theme.colors.destructive;
  if (pct >= 70) return theme.colors.palette.amber[500];
  return theme.colors.accent;
}

function getMeterGeometry(showPercentage: boolean) {
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      center: COMPACT_CENTER,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      circumference: COMPACT_CIRCUMFERENCE,
      containerStyle: styles.containerWithLabel,
    };
  }
  return {
    svgSize: SVG_SIZE,
    center: CENTER,
    radius: RADIUS,
    strokeWidth: STROKE_WIDTH,
    circumference: CIRCUMFERENCE,
    containerStyle: styles.container,
  };
}

function formatResetsAtLabel(resetsAt: string | undefined): string {
  if (!resetsAt) return "";
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "";
  if (diffMs <= 0) return "resetting now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `resets ${diffDays}d`;
  if (diffHours > 0) return `resets ${diffHours}h`;
  return `resets ${diffMinutes}m`;
}

function QuotaUsageBar({
  label,
  utilizationPct,
  resetsAt,
  theme,
}: {
  label: string;
  utilizationPct: number;
  resetsAt?: string;
  theme: ReturnType<typeof useUnistyles>["theme"];
}) {
  const pct = clampPercentage(utilizationPct);
  const barColor = getBarColor(pct, theme);
  const resetLabel = formatResetsAtLabel(resetsAt);

  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.usageBarFill, { width: `${pct}%`, backgroundColor: barColor }],
    [pct, barColor],
  );

  return (
    <View style={styles.usageBarContainer}>
      <View style={styles.usageBarRow}>
        <Text style={styles.usageBarLabel}>{label}</Text>
        <Text style={styles.usageBarValue}>
          {`${Math.round(pct)}%`}
          {resetLabel ? ` · ${resetLabel}` : ""}
        </Text>
      </View>
      <View style={styles.usageBarTrack}>
        <View style={fillStyle} />
      </View>
    </View>
  );
}

type ProviderQuota = NonNullable<
  ReturnType<typeof useSessionStore.getState>["sessions"][string]["providerQuota"]
>;

function ClaudeQuotaContent({
  quota,
  theme,
}: {
  quota: NonNullable<ProviderQuota["claude"]>;
  theme: ReturnType<typeof useUnistyles>["theme"];
}) {
  return (
    <>
      <Text style={styles.tooltipTitle}>{`Plan usage${quota.plan ? ` · ${quota.plan}` : ""}`}</Text>
      {quota.fiveHour ? (
        <QuotaUsageBar
          label="5-hour limit"
          utilizationPct={quota.fiveHour.utilizationPct}
          resetsAt={quota.fiveHour.resetsAt}
          theme={theme}
        />
      ) : null}
      {quota.sevenDay ? (
        <QuotaUsageBar
          label="Weekly · all models"
          utilizationPct={quota.sevenDay.utilizationPct}
          resetsAt={quota.sevenDay.resetsAt}
          theme={theme}
        />
      ) : null}
      {quota.sevenDayOpus ? (
        <QuotaUsageBar
          label="Weekly · Opus"
          utilizationPct={quota.sevenDayOpus.utilizationPct}
          resetsAt={quota.sevenDayOpus.resetsAt}
          theme={theme}
        />
      ) : null}
    </>
  );
}

function CodexQuotaContent({
  quota,
  theme,
}: {
  quota: NonNullable<ProviderQuota["codex"]>;
  theme: ReturnType<typeof useUnistyles>["theme"];
}) {
  return (
    <>
      <Text
        style={styles.tooltipTitle}
      >{`Plan usage${quota.planType ? ` · ${quota.planType}` : ""}`}</Text>
      {quota.session ? (
        <QuotaUsageBar
          label="Session"
          utilizationPct={quota.session.utilizationPct}
          resetsAt={quota.session.resetsAt}
          theme={theme}
        />
      ) : null}
      {quota.weekly ? (
        <QuotaUsageBar
          label="Weekly"
          utilizationPct={quota.weekly.utilizationPct}
          resetsAt={quota.weekly.resetsAt}
          theme={theme}
        />
      ) : null}
    </>
  );
}

function PlanUsageSection({
  provider,
  providerQuota,
}: {
  provider: string | null | undefined;
  providerQuota: ProviderQuota | null;
}) {
  const { theme } = useUnistyles();
  const p = provider?.toLowerCase();
  if (p !== "claude" && p !== "codex") return null;

  let content: ReactNode;
  if (p === "claude") {
    content = providerQuota?.claude ? (
      <ClaudeQuotaContent quota={providerQuota.claude} theme={theme} />
    ) : (
      <Text style={styles.tooltipDetail}>Loading plan usage…</Text>
    );
  } else {
    content = providerQuota?.codex ? (
      <CodexQuotaContent quota={providerQuota.codex} theme={theme} />
    ) : (
      <Text style={styles.tooltipDetail}>Loading plan usage…</Text>
    );
  }

  return (
    <>
      <View style={styles.tooltipDivider} />
      {content}
    </>
  );
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
  showPercentage = false,
  serverId,
  selectedModel: _selectedModel,
  provider,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const percentage = getUsagePercentage(maxTokens, usedTokens);

  const providerQuota = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.providerQuota ?? null) : null,
  );

  if (percentage === null) {
    return null;
  }

  const clampedPercentage = clampPercentage(percentage);
  const roundedPercentage = Math.round(percentage);
  const { svgSize, center, radius, strokeWidth, circumference, containerStyle } =
    getMeterGeometry(showPercentage);
  const dashOffset = circumference - (clampedPercentage / 100) * circumference;
  const colors = getMeterColors(clampedPercentage, theme);
  const formattedSessionCost =
    typeof totalCostUsd === "number" ? formatSessionCost(totalCostUsd) : null;

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={containerStyle}
          accessibilityRole="image"
          accessibilityLabel={`Context window ${roundedPercentage}% used`}
        >
          <Svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            style={styles.svg}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={colors.track}
              strokeWidth={strokeWidth}
            />
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={colors.progress}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </Svg>
          {showPercentage ? (
            <Text style={styles.percentageLabel}>{`${roundedPercentage}%`}</Text>
          ) : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>Context window</Text>
          <Text style={styles.tooltipText}>{`${roundedPercentage}% used`}</Text>
          <Text
            style={styles.tooltipDetail}
          >{`${formatTokenCount(usedTokens)} / ${formatTokenCount(maxTokens)} tokens`}</Text>
          {formattedSessionCost ? (
            <Text style={styles.tooltipDetail}>{`Session cost ${formattedSessionCost}`}</Text>
          ) : null}
          <PlanUsageSection provider={provider} providerQuota={providerQuota} />
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  containerWithLabel: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
  percentageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  tooltipContent: {
    gap: theme.spacing[1],
    minWidth: 200,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  tooltipDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing[1] + 1,
  },
  usageBarContainer: {
    gap: 3,
  },
  usageBarRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  usageBarLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  usageBarValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
  },
  usageBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  usageBarFill: {
    height: 4,
    borderRadius: 2,
  },
}));
