import { useMemo } from "react";
import type { ViewStyle } from "react-native";
import { useUnistyles } from "react-native-unistyles";

// CSS scrollbar properties are supported by React Native Web at runtime
// but are not included in React Native's ViewStyle type definition.
interface WebScrollbarStyle extends ViewStyle {
  scrollbarColor: string;
  scrollbarWidth: string;
}

export type WebScrollbarVariant = "default" | "subtle";

export function useWebScrollbarStyle(variant: WebScrollbarVariant = "default"): WebScrollbarStyle {
  const { theme } = useUnistyles();
  // "subtle" keeps the handle close to the surface tone so it does not jump
  // out inside tinted cards (e.g. tool call details).
  const handleColor = variant === "subtle" ? theme.colors.surface3 : theme.colors.scrollbarHandle;
  return useMemo(
    (): WebScrollbarStyle => ({
      scrollbarColor: `${handleColor} transparent`,
      scrollbarWidth: "thin",
    }),
    [handleColor],
  );
}
