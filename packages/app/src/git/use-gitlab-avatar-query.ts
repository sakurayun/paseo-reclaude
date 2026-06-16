import { useQuery } from "@tanstack/react-query";
import { buildGitLabAvatarApiUrl, isGravatarUrl, type RepoAvatarHost } from "./repo-avatar";

const GITLAB_AVATAR_FETCH_TIMEOUT_MS = 6_000;

interface UseGitLabAvatarUrlOptions {
  host: RepoAvatarHost | null;
  email: string | undefined;
  size: number;
}

interface GitLabAvatarResult {
  /** Custom GitLab-hosted avatar URL, or null if the forge has none for this email. */
  url: string | null;
  /** True only while the first lookup for this email is in flight. */
  isResolving: boolean;
}

/**
 * Resolve a GitLab user's custom avatar from their commit email via GitLab's
 * public `/api/v4/avatar` endpoint. Works for gitlab.com and any self-hosted
 * instance the client can reach (the daemon-co-located desktop/web client
 * reaches private instances; a remote phone gracefully gets null on failure).
 *
 * Gravatar answers are discarded so the caller's own Gravatar→initials fallback
 * stays authoritative. Any failure (unreachable host, 403 on a restricted
 * instance, CORS on web, timeout) resolves to null — never throwing into the UI.
 */
export function useGitLabAvatarUrl({
  host,
  email,
  size,
}: UseGitLabAvatarUrlOptions): GitLabAvatarResult {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const enabled = host?.kind === "gitlab" && normalizedEmail.length > 0;

  const query = useQuery({
    queryKey: ["gitlabAvatar", host?.host ?? "", normalizedEmail, size] as const,
    enabled,
    // Avatars are effectively immutable for a session; never refetch or evict.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!host) return null;
      const apiUrl = buildGitLabAvatarApiUrl({ host, email: normalizedEmail, size });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GITLAB_AVATAR_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const data: unknown = await response.json();
        const avatarUrl =
          data && typeof data === "object" && "avatar_url" in data
            ? (data as { avatar_url: unknown }).avatar_url
            : null;
        if (typeof avatarUrl !== "string" || !avatarUrl || isGravatarUrl(avatarUrl)) {
          return null;
        }
        return avatarUrl;
      } catch {
        // Unreachable host / CORS / abort: fall back to Gravatar upstream.
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  });

  return {
    url: enabled ? (query.data ?? null) : null,
    isResolving: enabled && query.isLoading,
  };
}
