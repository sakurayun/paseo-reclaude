import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { CompactHeader } from "./compact-header";
import { SidebarMenuToggle } from "./sidebar-menu-toggle";
import { useIsCompactFormFactor } from "@/constants/layout";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
  // Forwarded to ScreenHeader so callers can expose the header on a different
  // backdrop (e.g. the new theme's #fafafa shell) and drop the bottom divider.
  surfaceStyle?: StyleProp<ViewStyle>;
  rowStyle?: StyleProp<ViewStyle>;
}

export function MenuHeader({
  title,
  rightContent,
  borderless,
  surfaceStyle,
  rowStyle,
}: MenuHeaderProps) {
  const isCompact = useIsCompactFormFactor();
  if (isCompact) {
    return <CompactHeader navigation="menu" title={title} actions={rightContent} />;
  }
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
      surfaceStyle={surfaceStyle}
      rowStyle={rowStyle}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
}));
