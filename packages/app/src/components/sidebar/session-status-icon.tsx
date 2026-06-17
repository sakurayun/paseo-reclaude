import { useEffect, useMemo, type ComponentType, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { getProviderBrandColor, getProviderIcon } from "@/components/provider-icons";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { Theme } from "@/styles/theme";

const DEFAULT_ICON_SIZE = 12;

interface SessionStatusIconProps {
  provider: string;
  /** Lifecycle bucket that drives the icon tint and running animation. */
  stateBucket: SidebarStateBucket | null;
  /** Base provider-icon size; the breathing overlay and dot scale with it. */
  size?: number;
}

/**
 * Provider icon tinted by lifecycle state, with a breathing brand-color overlay
 * while running and a green dot when the agent wants attention. Shared by the
 * sidebar workspace sessions and the subagents track so both surfaces show the
 * same prominent running state.
 */
export function SessionStatusIcon({
  provider,
  stateBucket,
  size = DEFAULT_ICON_SIZE,
}: SessionStatusIconProps): ReactElement {
  const ProviderIcon = useMemo(() => {
    let colorMapping = mutedColorMapping;
    if (stateBucket === "failed") {
      colorMapping = failedColorMapping;
    } else if (stateBucket === "needs_input") {
      colorMapping = needsInputColorMapping;
    }
    return withUnistyles(getProviderIcon(provider), colorMapping);
  }, [provider, stateBucket]);

  const containerStyle = useMemo(() => [styles.sessionIcon, { width: size + 2 }], [size]);

  return (
    <View style={containerStyle}>
      <ProviderIcon size={size} />
      {stateBucket === "running" ? (
        <SessionRunningIconOverlay provider={provider} size={size} />
      ) : null}
      {stateBucket === "attention" ? <View style={styles.attentionDot} /> : null}
    </View>
  );
}

/**
 * Breathing colored copy of the provider icon, stacked over the gray base icon
 * while the agent is running. Opacity pulses 0 → 1 so the icon fades between
 * gray and the provider's brand color (theme accent as fallback).
 */
function SessionRunningIconOverlay({
  provider,
  size,
}: {
  provider: string;
  size: number;
}): ReactElement {
  const breath = useSharedValue(0);

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(breath);
    };
  }, [breath]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: breath.value }));
  const containerStyle = useMemo(() => [styles.iconOverlay, overlayStyle], [overlayStyle]);

  const OverlayIcon = useMemo((): ComponentType<{ size: number }> => {
    const Icon = getProviderIcon(provider);
    const brandColor = getProviderBrandColor(provider);
    if (brandColor) {
      const BrandedIcon = ({ size: iconSize }: { size: number }) => (
        <Icon size={iconSize} color={brandColor} />
      );
      BrandedIcon.displayName = `BrandedProviderIcon(${provider})`;
      return BrandedIcon;
    }
    return withUnistyles(Icon, accentColorMapping) as unknown as ComponentType<{ size: number }>;
  }, [provider]);

  return (
    <Animated.View style={containerStyle} pointerEvents="none">
      <OverlayIcon size={size} />
    </Animated.View>
  );
}

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});

const failedColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.red[500],
});

const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
});

const styles = StyleSheet.create((theme) => ({
  sessionIcon: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  attentionDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.palette.green[500],
  },
}));
