import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Server } from "lucide-react-native";
import { SimpleIconLogo } from "@/components/icons/os-logos";
import { useOsIcon } from "@/components/ssh/use-os-icon";
import type { Theme } from "@/styles/theme";

interface OsBadgeProps {
  os: string | null | undefined;
  size?: number;
}

// A rounded, brand-colored badge with the platform's white logo — the visual
// language of the host list (matches the Termius-style host icons).
// Built-in distros resolve offline; obscure systems load Simple Icons on demand.
export function OsBadge({ os, size = 40 }: OsBadgeProps) {
  const descriptor = useOsIcon(os);
  const glyphSize = Math.round(size * 0.5);
  const containerStyle = useMemo(
    () => [styles.badge, { width: size, height: size, backgroundColor: descriptor.color }],
    [size, descriptor.color],
  );

  const hasPath = Boolean(descriptor.path);

  return (
    <View style={containerStyle} accessibilityLabel={descriptor.label}>
      {hasPath ? (
        <SimpleIconLogo path={descriptor.path} size={glyphSize} color="#ffffff" />
      ) : (
        <Server size={glyphSize} color="#ffffff" />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  badge: {
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
}));
