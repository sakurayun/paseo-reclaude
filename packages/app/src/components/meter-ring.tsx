import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderUsageTone } from "@/provider-usage/types";
import type { Theme } from "@/styles/theme";

export const METER_SVG_SIZE = 14;
export const METER_STROKE_WIDTH = 2;

export type MeterRingVariant = "pending" | "muted" | "ok" | "warning" | "danger";

export interface MeterRingGeometry {
  svgSize: number;
  center: number;
  radius: number;
  strokeWidth: number;
  circumference: number;
}

export function resolveMeterRingGeometry(glyphSize?: number): MeterRingGeometry {
  const resolvedSize = glyphSize ?? METER_SVG_SIZE;
  const resolvedStrokeWidth = glyphSize ? 2 : METER_STROKE_WIDTH;
  return {
    svgSize: resolvedSize,
    center: resolvedSize / 2,
    radius: (resolvedSize - resolvedStrokeWidth) / 2,
    strokeWidth: resolvedStrokeWidth,
    circumference: Math.PI * (resolvedSize - resolvedStrokeWidth),
  };
}

export function clampMeterPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function meterVariantFromPercentage(percentage: number): MeterRingVariant {
  if (percentage > 90) return "danger";
  if (percentage >= 70) return "warning";
  return "muted";
}

export function meterVariantFromTone(tone: ProviderUsageTone): MeterRingVariant {
  switch (tone) {
    case "danger":
      return "danger";
    case "warning":
      return "warning";
    case "ok":
      return "ok";
    default:
      return "muted";
  }
}

const ringColorMapping = {
  pending: (theme: Theme) => ({
    progressColor: theme.colors.surface3,
    trackColor: theme.colors.surface3,
  }),
  muted: (theme: Theme) => ({
    progressColor: theme.colors.foregroundMuted,
    trackColor: theme.colors.surface3,
  }),
  ok: (theme: Theme) => ({
    progressColor: theme.colors.statusSuccess,
    trackColor: theme.colors.surface3,
  }),
  warning: (theme: Theme) => ({
    progressColor: theme.colors.palette.amber[500],
    trackColor: theme.colors.surface3,
  }),
  danger: (theme: Theme) => ({
    progressColor: theme.colors.destructive,
    trackColor: theme.colors.surface3,
  }),
} as const satisfies Record<
  MeterRingVariant,
  (theme: Theme) => { progressColor: string; trackColor: string }
>;

interface MeterRingGlyphBaseProps {
  percentage: number | null;
  progressColor: string;
  trackColor: string;
  glyphSize?: number;
}

function MeterRingGlyphBase({
  percentage,
  progressColor,
  trackColor,
  glyphSize,
}: MeterRingGlyphBaseProps) {
  const geometry = resolveMeterRingGeometry(glyphSize);
  const dashOffset =
    percentage === null
      ? geometry.circumference
      : geometry.circumference - (clampMeterPercentage(percentage) / 100) * geometry.circumference;

  return (
    <Svg
      width={geometry.svgSize}
      height={geometry.svgSize}
      viewBox={`0 0 ${geometry.svgSize} ${geometry.svgSize}`}
      style={styles.svg}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={geometry.center}
        cy={geometry.center}
        r={geometry.radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={geometry.strokeWidth}
      />
      {percentage !== null ? (
        <Circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.radius}
          fill="none"
          stroke={progressColor}
          strokeWidth={geometry.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={geometry.circumference}
          strokeDashoffset={dashOffset}
        />
      ) : null}
    </Svg>
  );
}

const ThemedMeterRingGlyph = withUnistyles(MeterRingGlyphBase);

interface MeterRingGlyphProps {
  percentage: number | null;
  variant: MeterRingVariant;
  glyphSize?: number;
}

/** Track-only or progress ring shared by context-window and provider-usage meters. */
export function MeterRingGlyph({ percentage, variant, glyphSize }: MeterRingGlyphProps) {
  return (
    <ThemedMeterRingGlyph
      percentage={percentage}
      glyphSize={glyphSize}
      uniProps={ringColorMapping[variant]}
    />
  );
}

export function MeterRingContainer({ children }: { children: ReactNode }) {
  return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
}));
