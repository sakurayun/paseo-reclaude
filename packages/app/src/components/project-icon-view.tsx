import { useMemo } from "react";
import {
  type StyleProp,
  Text,
  type TextStyle,
  type ImageStyle,
  type ViewStyle,
  View,
} from "react-native";
import type { ProjectAppearance } from "@getpaseo/protocol/messages";
import { projectIconTextColor } from "@/projects/icon-colors";
import { ProjectIconImage } from "@/components/project-icon-image";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

const WHITE_TEXT = { color: "#ffffff" } as const;
const FALLBACK_LAYOUT = { alignItems: "center", justifyContent: "center" } as const;

/**
 * Corner radius of the *generated* project icon — the colored square with an initial — as a
 * fraction of the box, so it reads as the same shape at 16pt in the sidebar and 40pt in the edit
 * sheet. Fixed tokens did not give that: the radius scale is coarse at the bottom, so small icons
 * landed on 2pt and looked square while large ones were visibly rounder.
 *
 * This is ours to shape. A **user-uploaded icon is never rounded** — it is someone's mark, and
 * clipping its corners distorts branding we don't own. A square logo stays square, a round one is
 * already round.
 */
const RADIUS_RATIO = 0.25;

export function projectIconRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}

/**
 * A project's icon: its chosen image, or a colored square carrying its initial.
 *
 * Geometry lives here, not at the call site. It used to be five copies of the same
 * width/height/radius/centering block, which is how the radius drifted apart in the first
 * place — pass a `size` and the shape follows.
 */

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  projectKey,
  appearance,
  imageStyle,
  fallbackStyle,
  size = 24,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey?: string;
  projectKey?: string;
  appearance?: ProjectAppearance | null;
  imageStyle?: StyleProp<ImageStyle>;
  fallbackStyle?: StyleProp<ViewStyle>;
  size?: number;
  textStyle: StyleProp<TextStyle>;
}) {
  // The uploaded image is sized but never clipped — see projectIconRadius.
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  const backgroundColor =
    appearance?.color ??
    identityColor(deriveIdentityColorName(projectViewKey ?? projectKey ?? initial));
  const label = appearance?.icon.type === "custom" ? appearance.icon.text : initial;
  const fallbackStyles = useMemo(
    () => [
      box,
      { borderRadius: projectIconRadius(size) },
      FALLBACK_LAYOUT,
      fallbackStyle,
      { backgroundColor },
    ],
    [box, size, fallbackStyle, backgroundColor],
  );
  const textStyles = useMemo(
    () => [
      textStyle,
      appearance?.color ? { color: projectIconTextColor(backgroundColor) } : WHITE_TEXT,
    ],
    [textStyle, appearance?.color, backgroundColor],
  );

  const fallback = useMemo(
    () => (
      <View style={fallbackStyles}>
        <Text adjustsFontSizeToFit numberOfLines={1} style={textStyles}>
          {label}
        </Text>
      </View>
    ),
    [fallbackStyles, label, textStyles],
  );

  return iconDataUri && appearance?.icon.type !== "custom" ? (
    <ProjectIconImage dataUri={iconDataUri} fallback={fallback} style={[box, imageStyle]} />
  ) : (
    fallback
  );
}
