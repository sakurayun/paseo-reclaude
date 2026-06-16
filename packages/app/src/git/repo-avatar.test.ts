import { describe, expect, it } from "vitest";
import {
  buildGitHubAvatarCandidates,
  buildGitLabAvatarApiUrl,
  buildGravatarUrl,
  detectRepoAvatarHost,
  isGravatarUrl,
  type RepoAvatarHost,
} from "./repo-avatar";

describe("detectRepoAvatarHost", () => {
  it.each([
    ["https://github.com/owner/repo.git", { kind: "github", host: "github.com", isPublic: true }],
    ["git@github.com:owner/repo.git", { kind: "github", host: "github.com", isPublic: true }],
    [
      "ssh://git@ssh.github.com/owner/repo.git",
      { kind: "github", host: "github.com", isPublic: true },
    ],
    ["https://gitlab.com/group/repo.git", { kind: "gitlab", host: "gitlab.com", isPublic: true }],
    ["git@gitlab.com:group/repo.git", { kind: "gitlab", host: "gitlab.com", isPublic: true }],
    [
      "https://gitlab.acme.example/group/repo.git",
      { kind: "gitlab", host: "gitlab.acme.example", isPublic: false },
    ],
    [
      "git@gitlab.internal.corp:team/repo.git",
      { kind: "gitlab", host: "gitlab.internal.corp", isPublic: false },
    ],
    [
      "https://github.acme.example/owner/repo.git",
      { kind: "github", host: "github.acme.example", isPublic: false },
    ],
  ])("classifies %s", (remote, expected) => {
    expect(detectRepoAvatarHost(remote)).toEqual(expected);
  });

  it.each([
    ["https://bitbucket.org/owner/repo.git", "bitbucket.org"],
    ["git@git.acme.example:owner/repo.git", "git.acme.example"],
    // A label name elsewhere in the URL (here the path) must not classify it.
    ["https://example.com/gitlab/repo.git", "example.com"],
  ])("returns 'unknown' for a reachable but unrecognized host %s", (remote, host) => {
    expect(detectRepoAvatarHost(remote)).toEqual({ kind: "unknown", host, isPublic: false });
  });

  it.each([[""], ["   "], ["not a url"], [null], [undefined]])(
    "returns null only for an absent or unparseable remote %s",
    (remote) => {
      expect(detectRepoAvatarHost(remote)).toBeNull();
    },
  );
});

const GITHUB_PUBLIC: RepoAvatarHost = { kind: "github", host: "github.com", isPublic: true };
const GITHUB_ENTERPRISE: RepoAvatarHost = {
  kind: "github",
  host: "github.acme.example",
  isPublic: false,
};
const UNKNOWN_HOST: RepoAvatarHost = { kind: "unknown", host: "git.acme.example", isPublic: false };

describe("buildGitHubAvatarCandidates", () => {
  it("uses the numeric id CDN then the username png for an id+username no-reply email", () => {
    expect(
      buildGitHubAvatarCandidates({
        host: GITHUB_PUBLIC,
        email: "1234567+octocat@users.noreply.github.com",
        size: 16,
      }),
    ).toEqual([
      "https://avatars.githubusercontent.com/u/1234567?s=32&v=4",
      "https://github.com/octocat.png?size=32",
    ]);
  });

  it("falls back to the username png for a legacy username-only no-reply email", () => {
    expect(
      buildGitHubAvatarCandidates({
        host: GITHUB_PUBLIC,
        email: "octocat@users.noreply.github.com",
        size: 16,
      }),
    ).toEqual(["https://github.com/octocat.png?size=32"]);
  });

  it("serves enterprise avatars from the enterprise host, never the public CDN", () => {
    expect(
      buildGitHubAvatarCandidates({
        host: GITHUB_ENTERPRISE,
        email: "1234567+octocat@users.noreply.github.acme.example",
        size: 16,
      }),
    ).toEqual(["https://github.acme.example/octocat.png?size=32"]);
  });

  it.each([
    ["octocat@example.com"],
    ["octocat@gmail.com"],
    ["1234567+octocat@users.noreply.gitlab.com"],
    [""],
    [undefined],
  ])("returns no candidates for non-no-reply email %s", (email) => {
    expect(buildGitHubAvatarCandidates({ host: GITHUB_PUBLIC, email, size: 16 })).toEqual([]);
  });

  it("rejects an invalid username in a no-reply email", () => {
    expect(
      buildGitHubAvatarCandidates({
        host: GITHUB_PUBLIC,
        email: "-bad-@users.noreply.github.com",
        size: 16,
      }),
    ).toEqual([]);
  });

  it("probes an unknown host's GitHub avatar only via a matching no-reply email", () => {
    expect(
      buildGitHubAvatarCandidates({
        host: UNKNOWN_HOST,
        email: "octocat@users.noreply.git.acme.example",
        size: 16,
      }),
    ).toEqual(["https://git.acme.example/octocat.png?size=32"]);
    // A real personal email on an unknown host has no GitHub lookup; only the
    // GitLab probe (handled by the avatar hook) can resolve it.
    expect(
      buildGitHubAvatarCandidates({ host: UNKNOWN_HOST, email: "dev@corp.example", size: 16 }),
    ).toEqual([]);
  });
});

describe("buildGitLabAvatarApiUrl", () => {
  it("builds an https avatar lookup with an encoded email and doubled size", () => {
    expect(
      buildGitLabAvatarApiUrl({
        host: { kind: "gitlab", host: "gitlab.com", isPublic: true },
        email: "User+Tag@Example.com",
        size: 16,
      }),
    ).toBe("https://gitlab.com/api/v4/avatar?email=user%2Btag%40example.com&size=32");
  });

  it("targets the self-hosted host", () => {
    expect(
      buildGitLabAvatarApiUrl({
        host: { kind: "gitlab", host: "gitlab.internal.corp", isPublic: false },
        email: "dev@corp.example",
        size: 24,
      }),
    ).toBe("https://gitlab.internal.corp/api/v4/avatar?email=dev%40corp.example&size=48");
  });
});

describe("isGravatarUrl", () => {
  it.each([
    ["https://www.gravatar.com/avatar/abc?s=64&d=identicon", true],
    ["https://secure.gravatar.com/avatar/abc", true],
    ["https://gravatar.com/avatar/abc", true],
    ["https://cn.gravatar.com/avatar/abc", true],
    ["https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png", false],
    ["https://example.com/notgravatar.com/x", false],
    ["not a url", false],
  ])("isGravatarUrl(%s) === %s", (url, expected) => {
    expect(isGravatarUrl(url)).toBe(expected);
  });
});

describe("buildGravatarUrl", () => {
  it("uses the cn mirror with d=404 and a doubled size", () => {
    const url = buildGravatarUrl({ email: "Person@Example.com", size: 16 });
    expect(url).toMatch(/^https:\/\/cn\.gravatar\.com\/avatar\/[0-9a-f]{32}\?s=32&d=404$/);
  });

  it("hashes the normalized (trimmed, lowercased) email", () => {
    expect(buildGravatarUrl({ email: "  Person@Example.com ", size: 16 })).toBe(
      buildGravatarUrl({ email: "person@example.com", size: 16 }),
    );
  });
});
