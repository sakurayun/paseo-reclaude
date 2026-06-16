import { BlurView } from "expo-blur";
import { useMemo, type ReactNode } from "react";
import {
  StyleSheet as RNStyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

export interface GlassSurfaceProps extends ViewProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function GlassSurface({ children, style, ...props }: GlassSurfaceProps) {
  const webStyle = useMemo(() => [styles.webSurface, style], [style]);
  const nativeStyle = useMemo(() => [styles.nativeSurface, style], [style]);

  if (isWeb) {
    return (
      <View {...props} style={webStyle}>
        {children}
      </View>
    );
  }

  return (
    <View {...props} style={nativeStyle}>
      <GlassSurfaceBackdrop />
      {children}
    </View>
  );
}

export function GlassSurfaceBackdrop() {
  if (isWeb) {
    return null;
  }

  return (
    <>
      <BlurView
        intensity={80}
        tint="systemMaterial"
        experimentalBlurMethod="dimezisBlurView"
        style={RNStyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.nativeTint} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  webSurface: {
    backgroundColor: theme.colors.surfaceGlass,
    backdropFilter: "blur(20px) saturate(1.5)",
    WebkitBackdropFilter: "blur(20px) saturate(1.5)",
  },
  nativeSurface: {
    backgroundColor: "transparent",
  },
  nativeTint: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surfaceGlass,
  },
}));
