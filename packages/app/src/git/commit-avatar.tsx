import { useCallback, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { md5Hex } from "@/utils/md5";

export const COMMIT_AVATAR_SIZE = 16;

/**
 * Hue wheel for author identity colors. Saturation/lightness are fixed at
 * values that read on both light and dark sidebars, so only the hue is
 * derived from the author.
 */
const AVATAR_HUE_COUNT = 12;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function avatarColor(identity: string): string {
  const hue = (hashString(identity) % AVATAR_HUE_COUNT) * (360 / AVATAR_HUE_COUNT);
  return `hsl(${hue}, 45%, 45%)`;
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  // Single-word names (including CJK) show their first character.
  return trimmed.slice(0, 1).toUpperCase();
}

/**
 * `d=404` makes Gravatar return an HTTP error for unknown emails instead of a
 * generated placeholder, so the initials fallback shows for them.
 */
function gravatarUri(email: string, size: number): string {
  const hash = md5Hex(email.trim().toLowerCase());
  return `https://cn.gravatar.com/avatar/${hash}?s=${size * 2}&d=404`;
}

interface CommitAvatarProps {
  name: string;
  email?: string;
  size?: number;
}

/**
 * Author avatar: Gravatar (cn mirror) when the email has one, otherwise a
 * deterministic initials circle — same author always gets the same color,
 * keyed by email so name variants still group together.
 */
export function CommitAvatar({ name, email, size = COMMIT_AVATAR_SIZE }: CommitAvatarProps) {
  const trimmedEmail = email?.trim() ?? "";
  const identity = trimmedEmail || name.trim();
  const [imageFailed, setImageFailed] = useState(false);
  const handleImageError = useCallback(() => setImageFailed(true), []);

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor(identity),
      },
    ],
    [identity, size],
  );
  const textStyle = useMemo(() => [styles.text, { fontSize: Math.round(size * 0.55) }], [size]);
  const imageSource = useMemo(
    () => (trimmedEmail ? { uri: gravatarUri(trimmedEmail, size) } : null),
    [trimmedEmail, size],
  );
  const imageStyle = useMemo(
    () => [styles.image, { width: size, height: size, borderRadius: size / 2 }],
    [size],
  );

  return (
    <View style={containerStyle} accessibilityLabel={name}>
      <Text style={textStyle} numberOfLines={1}>
        {initialsFor(name)}
      </Text>
      {imageSource && !imageFailed ? (
        // Sits on top of the initials; unknown emails 404 and reveal them.
        <Image source={imageSource} style={imageStyle} onError={handleImageError} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  text: {
    color: "#ffffff",
    fontWeight: "600",
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
  },
}));
