import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Server } from "lucide-react-native";
import { getOsIcon } from "@/components/ssh/os-icons";
import type { Theme } from "@/styles/theme";

interface OsBadgeProps {
  os: string | null | undefined;
  size?: number;
}

// A rounded, brand-colored badge with the platform's white logo — the visual
// language of the host list (matches the Termius-style host icons).
export function OsBadge({ os, size = 40 }: OsBadgeProps) {
  const descriptor = useMemo(() => getOsIcon(os), [os]);
  const glyphSize = Math.round(size * 0.5);
  const containerStyle = useMemo(
    () => [styles.badge, { width: size, height: size, backgroundColor: descriptor.color }],
    [size, descriptor.color],
  );

  return (
    <View style={containerStyle}>
      {descriptor.Logo ? (
        <descriptor.Logo size={glyphSize} color="#ffffff" />
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
