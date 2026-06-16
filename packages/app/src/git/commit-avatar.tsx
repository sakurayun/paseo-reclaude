import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { buildGitHubAvatarCandidates, buildGravatarUrl, type RepoAvatarHost } from "./repo-avatar";
import { useGitLabAvatarUrl } from "./use-gitlab-avatar-query";

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

/** Forge-specific avatar sources (GitHub direct images / a resolved GitLab avatar). */
function forgeCandidates(params: {
  repoHost: RepoAvatarHost | null;
  email: string;
  size: number;
  gitlabUrl: string | null;
}): string[] {
  const { repoHost, email, size, gitlabUrl } = params;
  if (repoHost?.kind === "github") {
    return buildGitHubAvatarCandidates({ host: repoHost, email, size });
  }
  if (repoHost?.kind === "gitlab" && gitlabUrl) {
    return [gitlabUrl];
  }
  return [];
}

interface CommitAvatarProps {
  name: string;
  email?: string;
  size?: number;
  /**
   * Detected forge for the surrounding repo. When set, the author avatar
   * prefers that forge's avatar (GitHub/GitLab) before falling back to
   * Gravatar. Null/undefined keeps the plain Gravatar→initials behavior.
   */
  repoHost?: RepoAvatarHost | null;
}

/**
 * Author avatar with a forge-aware source chain: the repo's own forge avatar
 * (GitHub direct image / GitLab custom avatar) first, then Gravatar (cn mirror),
 * then a deterministic initials circle. Each remote source that fails to load
 * advances to the next; the same author always gets the same fallback color,
 * keyed by email so name variants still group together.
 */
export function CommitAvatar({
  name,
  email,
  size = COMMIT_AVATAR_SIZE,
  repoHost = null,
}: CommitAvatarProps) {
  const trimmedEmail = email?.trim() ?? "";
  const identity = trimmedEmail || name.trim();

  const gitlabAvatar = useGitLabAvatarUrl({ host: repoHost, email: trimmedEmail, size });

  // Ordered remote sources: forge-specific first, Gravatar last. While a GitLab
  // lookup is still in flight we hold off on the whole chain so the forge avatar
  // wins instead of flashing Gravatar first; the initials circle shows meanwhile.
  const candidates = useMemo<string[]>(() => {
    if (!trimmedEmail) return [];
    if (gitlabAvatar.isResolving) return [];
    const forge = forgeCandidates({
      repoHost,
      email: trimmedEmail,
      size,
      gitlabUrl: gitlabAvatar.url,
    });
    return [...forge, buildGravatarUrl({ email: trimmedEmail, size })];
  }, [trimmedEmail, repoHost, size, gitlabAvatar.isResolving, gitlabAvatar.url]);

  // Walk the chain on each load error; reset whenever the source list changes.
  const candidatesKey = candidates.join("|");
  const [failedCount, setFailedCount] = useState(0);
  useEffect(() => {
    setFailedCount(0);
  }, [candidatesKey]);
  const handleImageError = useCallback(() => setFailedCount((count) => count + 1), []);

  const activeUri = candidates[failedCount] ?? null;

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
  const imageSource = useMemo(() => (activeUri ? { uri: activeUri } : null), [activeUri]);
  const imageStyle = useMemo(
    () => [styles.image, { width: size, height: size, borderRadius: size / 2 }],
    [size],
  );

  return (
    <View style={containerStyle} accessibilityLabel={name}>
      <Text style={textStyle} numberOfLines={1}>
        {initialsFor(name)}
      </Text>
      {imageSource ? (
        // Sits on top of the initials; a failed/unknown source reveals them.
        <Image key={activeUri} source={imageSource} style={imageStyle} onError={handleImageError} />
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
