import { describe, expect, it, vi } from "vitest";

import {
  applyGithubMirror,
  downloadWithGithubMirrorFallback,
  expandGithubDownloadCandidates,
  isGithubUrl,
  patchHttpExecutorWithGithubMirrors,
  shouldPreferGithubMirrors,
} from "./github-release-mirrors";

const SAMPLE_ASSET =
  "https://github.com/sakurayun/paseo-reclaude/releases/download/v0.1.130/Paseo-0.1.130-arm64.zip";

describe("shouldPreferGithubMirrors", () => {
  it("detects mainland China from timezone", () => {
    expect(shouldPreferGithubMirrors({ timeZone: "Asia/Shanghai" })).toBe(true);
    expect(shouldPreferGithubMirrors({ timeZone: "Asia/Urumqi" })).toBe(true);
    expect(shouldPreferGithubMirrors({ timeZone: "America/Los_Angeles" })).toBe(false);
  });

  it("detects mainland China from locale tags", () => {
    expect(shouldPreferGithubMirrors({ locale: "zh-CN" })).toBe(true);
    expect(shouldPreferGithubMirrors({ locale: "zh_CN" })).toBe(true);
    expect(shouldPreferGithubMirrors({ locale: "zh-Hans-CN" })).toBe(true);
    expect(shouldPreferGithubMirrors({ locales: ["en-US", "zh-CN"] })).toBe(true);
    expect(shouldPreferGithubMirrors({ locale: "en-US" })).toBe(false);
    expect(shouldPreferGithubMirrors({ locale: "zh-TW" })).toBe(false);
  });
});

describe("expandGithubDownloadCandidates", () => {
  it("returns only the original URL for non-GitHub hosts", () => {
    const url = "https://paseo.sh/download/Paseo.dmg";
    expect(expandGithubDownloadCandidates(url, true).map((item) => item.href)).toEqual([url]);
  });

  it("puts mirrors first when preferMirrors is true", () => {
    const candidates = expandGithubDownloadCandidates(SAMPLE_ASSET, true).map((item) => item.href);
    expect(candidates[0]).toBe(`https://ghfast.top/${SAMPLE_ASSET}`);
    expect(candidates.at(-1)).toBe(SAMPLE_ASSET);
    expect(candidates.length).toBeGreaterThan(3);
  });

  it("puts the original URL first when preferMirrors is false", () => {
    const candidates = expandGithubDownloadCandidates(SAMPLE_ASSET, false).map((item) => item.href);
    expect(candidates[0]).toBe(SAMPLE_ASSET);
    expect(candidates).toContain(`https://gh-proxy.com/${SAMPLE_ASSET}`);
  });

  it("applies host-style mirrors", () => {
    const mirrored = applyGithubMirror(new URL(SAMPLE_ASSET), {
      kind: "host",
      host: "kkgithub.com",
    });
    expect(mirrored.href).toBe(
      "https://kkgithub.com/sakurayun/paseo-reclaude/releases/download/v0.1.130/Paseo-0.1.130-arm64.zip",
    );
  });

  it("recognizes githubusercontent asset hosts", () => {
    expect(
      isGithubUrl(
        "https://release-assets.githubusercontent.com/github-production-release-asset/123/abc",
      ),
    ).toBe(true);
  });
});

describe("downloadWithGithubMirrorFallback", () => {
  it("retries the next candidate after a failure", async () => {
    const attempts: string[] = [];
    const result = await downloadWithGithubMirrorFallback(
      SAMPLE_ASSET,
      async (candidate) => {
        attempts.push(candidate.href);
        if (attempts.length < 2) {
          throw new Error("mirror down");
        }
        return "ok";
      },
      { preferMirrors: true },
    );

    expect(result).toBe("ok");
    expect(attempts.length).toBe(2);
    expect(attempts[0]).toMatch(/^https:\/\/ghfast\.top\//);
  });

  it("surfaces the last error when every candidate fails", async () => {
    await expect(
      downloadWithGithubMirrorFallback(
        SAMPLE_ASSET,
        async () => {
          throw new Error("blocked");
        },
        { preferMirrors: true },
      ),
    ).rejects.toThrow("blocked");
  });
});

describe("patchHttpExecutorWithGithubMirrors", () => {
  it("rewrites download attempts through the mirror list", async () => {
    const attempts: string[] = [];
    const executor = {
      download: vi.fn(async (url: URL) => {
        attempts.push(url.href);
        if (attempts.length === 1) {
          throw new Error("first mirror failed");
        }
        return "downloaded";
      }),
    };

    patchHttpExecutorWithGithubMirrors(executor, {
      shouldPreferMirrors: () => true,
    });

    await expect(executor.download(new URL(SAMPLE_ASSET), "/tmp/out.zip", {})).resolves.toBe(
      "downloaded",
    );
    expect(attempts[0]).toMatch(/^https:\/\/ghfast\.top\//);
    expect(attempts.length).toBe(2);
  });
});
