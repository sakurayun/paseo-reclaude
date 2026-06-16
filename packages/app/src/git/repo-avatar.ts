import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { md5Hex } from "@/utils/md5";

/**
 * Repo-host-aware commit avatars. The author avatar prefers the avatar
 * configured on the repository's own forge (GitHub / GitLab, public or
 * self-hosted), derived from the repo's `remoteUrl`, and falls back to
 * Gravatar (then initials) when the forge has nothing for that author.
 *
 * Everything here is pure URL/identity logic so it can be unit-tested without a
 * network or React. The actual GitLab lookup (which needs a fetch) lives in
 * `use-gitlab-avatar-query.ts`; GitHub avatars are plain image URLs that
 * `<Image>` can load directly, so no fetch is needed for them.
 */

export type RepoAvatarHostKind = "github" | "gitlab" | "unknown";

export interface RepoAvatarHost {
  /**
   * The forge we believe is behind the remote. `"unknown"` is a reachable but
   * unrecognized self-hosted host — we probe both GitHub and GitLab once before
   * Gravatar rather than skipping straight to it.
   */
  kind: RepoAvatarHostKind;
  /** Normalized lowercase hostname, e.g. "github.com" or "gitlab.example.com". */
  host: string;
  /** True for the well-known public instance (github.com / gitlab.com). */
  isPublic: boolean;
}

const GITHUB_PUBLIC_HOSTS = new Set(["github.com", "ssh.github.com"]);
const GITLAB_PUBLIC_HOST = "gitlab.com";

/** github.com SSH remotes report `ssh.github.com`; collapse to the web host. */
function canonicalHost(host: string): string {
  return host === "ssh.github.com" ? "github.com" : host;
}

/**
 * Identify the forge behind a git remote so we know which avatar service to
 * prefer. Public github.com / gitlab.com are matched exactly; self-hosted
 * instances are identified by the product name appearing in the hostname
 * (e.g. `gitlab.acme.com`, `github.acme.com`) — the only signal we have
 * client-side. A reachable host whose forge we can't name is returned as
 * `"unknown"` so the caller can probe both forges before Gravatar. Only an
 * absent or unparseable remote returns null.
 */
export function detectRepoAvatarHost(remoteUrl: string | null | undefined): RepoAvatarHost | null {
  const trimmed = remoteUrl?.trim();
  if (!trimmed) return null;
  const location = parseGitRemoteLocation(trimmed);
  if (!location) return null;
  const host = location.host;

  if (GITHUB_PUBLIC_HOSTS.has(host)) {
    return { kind: "github", host: canonicalHost(host), isPublic: true };
  }
  if (host === GITLAB_PUBLIC_HOST) {
    return { kind: "gitlab", host, isPublic: true };
  }
  // Self-hosted heuristics — the hostname is the only client-side hint.
  if (hostContainsLabel(host, "github")) {
    return { kind: "github", host, isPublic: false };
  }
  if (hostContainsLabel(host, "gitlab")) {
    return { kind: "gitlab", host, isPublic: false };
  }
  // Unrecognized but valid host: let the caller try GitHub and GitLab once each.
  return { kind: "unknown", host, isPublic: false };
}

/** Match the product name as a dot-delimited label, not an arbitrary substring. */
function hostContainsLabel(host: string, label: string): boolean {
  return host.split(".").some((part) => part.includes(label));
}

// GitHub usernames: 1–39 chars, alphanumeric or single hyphens, no leading or
// trailing hyphen. Validated before interpolation into an avatar URL.
const GITHUB_USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * Ordered list of direct GitHub avatar image URLs for a commit author, derived
 * from a GitHub no-reply commit email. Returns `[]` when the email isn't a
 * no-reply address for this host (arbitrary emails have no public lookup).
 *
 * Two no-reply forms are handled:
 *   - `<id>+<username>@users.noreply.github.com` → `avatars.githubusercontent.com/u/<id>`
 *   - `<username>@users.noreply.github.com`      → `<host>/<username>.png`
 */
export function buildGitHubAvatarCandidates(params: {
  host: RepoAvatarHost;
  email: string | undefined;
  size: number;
}): string[] {
  const { host } = params;
  const email = params.email?.trim().toLowerCase();
  if (!email) return [];

  const suffix = `@users.noreply.${host.host}`;
  if (!email.endsWith(suffix)) return [];
  const local = email.slice(0, -suffix.length);
  if (!local) return [];

  const px = avatarPixels(params.size);
  const plus = local.indexOf("+");
  const numericId = plus > 0 ? local.slice(0, plus) : null;
  const username = plus > 0 ? local.slice(plus + 1) : local;

  const candidates: string[] = [];
  // The numeric-id CDN URL only exists for github.com; enterprise hosts serve
  // avatars from their own domain via the `.png` form below.
  if (host.isPublic && numericId && /^\d+$/.test(numericId)) {
    candidates.push(`https://avatars.githubusercontent.com/u/${numericId}?s=${px}&v=4`);
  }
  if (GITHUB_USERNAME.test(username)) {
    const base = host.isPublic ? "https://github.com" : `https://${host.host}`;
    candidates.push(`${base}/${encodeURIComponent(username)}.png?size=${px}`);
  }
  return candidates;
}

/**
 * GitLab's public "avatar for an email" endpoint. Returns JSON
 * (`{ avatar_url }`), so it must be fetched (see use-gitlab-avatar-query.ts)
 * rather than handed straight to `<Image>`.
 */
export function buildGitLabAvatarApiUrl(params: {
  host: RepoAvatarHost;
  email: string;
  size: number;
}): string {
  const email = encodeURIComponent(params.email.trim().toLowerCase());
  const size = avatarPixels(params.size);
  // SSH/SCP remotes carry no scheme; default to https (GitLab serves https and
  // a phone on https can't load mixed http content anyway).
  return `https://${params.host.host}/api/v4/avatar?email=${email}&size=${size}`;
}

const GRAVATAR_HOST_SUFFIX = "gravatar.com";

/**
 * GitLab returns a Gravatar URL for users without a custom GitLab avatar. We
 * keep our own Gravatar→initials fallback in control, so a Gravatar answer from
 * GitLab is treated as "no forge avatar".
 */
export function isGravatarUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === GRAVATAR_HOST_SUFFIX || host.endsWith(`.${GRAVATAR_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

/**
 * Gravatar fallback (cn mirror). `d=404` makes Gravatar 404 for unknown emails
 * instead of returning a generated placeholder, so the initials fallback shows.
 */
export function buildGravatarUrl(params: { email: string; size: number }): string {
  const hash = md5Hex(params.email.trim().toLowerCase());
  return `https://cn.gravatar.com/avatar/${hash}?s=${avatarPixels(params.size)}&d=404`;
}

/** Request 2× pixels for crisp rendering on retina displays. */
function avatarPixels(size: number): number {
  return Math.max(1, Math.round(size * 2));
}
