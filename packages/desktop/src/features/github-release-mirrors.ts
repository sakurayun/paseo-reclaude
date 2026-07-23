/**
 * GitHub release download acceleration for mainland China.
 *
 * electron-updater pulls both channel manifests and install artifacts from
 * github.com. When the host appears to be in mainland China we try a short
 * list of public proxy mirrors first, then fall back to the original URL.
 */

export type GithubMirrorTransform =
  | { kind: "prefix"; prefix: string }
  | { kind: "host"; host: string };

/** Public GitHub acceleration mirrors commonly used in mainland China. */
export const GITHUB_RELEASE_MIRRORS: readonly GithubMirrorTransform[] = [
  { kind: "prefix", prefix: "https://ghfast.top/" },
  { kind: "prefix", prefix: "https://gh-proxy.com/" },
  { kind: "prefix", prefix: "https://mirror.ghproxy.com/" },
  { kind: "prefix", prefix: "https://ghproxy.net/" },
  { kind: "host", host: "kkgithub.com" },
  { kind: "host", host: "bgithub.xyz" },
];

const GITHUB_HOSTS = new Set(["github.com", "www.github.com", "api.github.com"]);

export function isGithubHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (GITHUB_HOSTS.has(host)) {
    return true;
  }
  // Release assets often redirect to objects.githubusercontent.com /
  // release-assets.githubusercontent.com. Those hosts are also blocked in CN.
  return host.endsWith(".githubusercontent.com");
}

export function isGithubUrl(url: URL | string): boolean {
  try {
    const parsed = typeof url === "string" ? new URL(url) : url;
    return parsed.protocol === "https:" && isGithubHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function applyGithubMirror(url: URL, mirror: GithubMirrorTransform): URL {
  if (mirror.kind === "prefix") {
    return new URL(`${mirror.prefix}${url.href}`);
  }
  const next = new URL(url.href);
  if (next.hostname === "api.github.com") {
    // Host-style mirrors generally only proxy the github.com site/assets, not
    // the REST API. Leave API calls on the original host for those transforms.
    return next;
  }
  next.hostname = mirror.host;
  return next;
}

/**
 * Heuristic: prefer mirrors when the OS locale or timezone looks mainland CN.
 * This avoids a network geo-IP probe (which itself can fail offline / behind
 * corporate proxies).
 */
export function shouldPreferGithubMirrors(input?: {
  locale?: string | null;
  locales?: readonly string[] | null;
  timeZone?: string | null;
}): boolean {
  const timeZone = input?.timeZone?.trim() ?? "";
  if (timeZone === "Asia/Shanghai" || timeZone === "Asia/Urumqi") {
    return true;
  }

  const candidates: string[] = [];
  if (input?.locale) {
    candidates.push(input.locale);
  }
  if (input?.locales) {
    for (const locale of input.locales) {
      candidates.push(locale);
    }
  }

  for (const locale of candidates) {
    const normalized = locale.trim().toLowerCase().replaceAll("_", "-");
    if (
      normalized === "zh-cn" ||
      normalized === "zh-hans" ||
      normalized === "zh-hans-cn" ||
      normalized.startsWith("zh-cn-") ||
      normalized.startsWith("zh-hans-")
    ) {
      return true;
    }
  }

  return false;
}

export function expandGithubDownloadCandidates(
  url: URL | string,
  preferMirrors: boolean,
  mirrors: readonly GithubMirrorTransform[] = GITHUB_RELEASE_MIRRORS,
): URL[] {
  const original = typeof url === "string" ? new URL(url) : new URL(url.href);
  if (!isGithubUrl(original)) {
    return [original];
  }

  const mirrored: URL[] = [];
  for (const mirror of mirrors) {
    try {
      const next = applyGithubMirror(original, mirror);
      if (next.href !== original.href) {
        mirrored.push(next);
      }
    } catch {
      // Skip malformed mirror transforms.
    }
  }

  if (preferMirrors) {
    return [...mirrored, original];
  }
  return [original, ...mirrored];
}

export async function downloadWithGithubMirrorFallback<T>(
  url: URL | string,
  download: (candidate: URL) => Promise<T>,
  options?: {
    preferMirrors?: boolean;
    mirrors?: readonly GithubMirrorTransform[];
    onAttemptError?: (input: { candidate: URL; error: unknown; remaining: number }) => void;
  },
): Promise<T> {
  const preferMirrors = options?.preferMirrors ?? false;
  const candidates = expandGithubDownloadCandidates(url, preferMirrors, options?.mirrors);
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    try {
      return await download(candidate);
    } catch (error) {
      lastError = error;
      options?.onAttemptError?.({
        candidate,
        error,
        remaining: candidates.length - index - 1,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GitHub download failed for ${String(url)}: ${String(lastError)}`);
}

type DownloadFn = (url: URL, destination: string, options: unknown) => Promise<unknown>;
type DownloadToBufferFn = (url: URL, options: unknown) => Promise<Buffer>;
type RequestFn = (
  options: {
    protocol?: string;
    hostname?: string;
    host?: string;
    path?: string;
    port?: string | number;
  },
  cancellationToken?: unknown,
  data?: unknown,
) => Promise<unknown>;

export interface GithubMirrorHttpExecutorTarget {
  download: DownloadFn;
  downloadToBuffer?: DownloadToBufferFn;
  request?: RequestFn;
}

function requestOptionsToUrl(options: {
  protocol?: string;
  hostname?: string;
  host?: string;
  path?: string;
  port?: string | number;
}): URL | null {
  const host = options.hostname ?? options.host;
  if (!host || !options.path) {
    return null;
  }
  const protocol = options.protocol ?? "https:";
  const port =
    options.port != null && String(options.port).length > 0 && String(options.port) !== "443"
      ? `:${options.port}`
      : "";
  try {
    return new URL(`${protocol}//${host}${port}${options.path}`);
  } catch {
    return null;
  }
}

function applyUrlToRequestOptions(
  options: {
    protocol?: string;
    hostname?: string;
    host?: string;
    path?: string;
    port?: string | number;
  },
  url: URL,
): typeof options {
  return {
    ...options,
    protocol: url.protocol,
    hostname: url.hostname,
    host: url.host,
    path: `${url.pathname}${url.search}`,
    port: url.port || undefined,
  };
}

/**
 * Monkey-patches an electron-updater ElectronHttpExecutor so channel-file
 * requests and large artifact downloads retry across CN GitHub mirrors.
 */
export function patchHttpExecutorWithGithubMirrors(
  executor: GithubMirrorHttpExecutorTarget,
  deps: {
    shouldPreferMirrors: () => boolean;
    onAttemptError?: (input: { candidate: URL; error: unknown; remaining: number }) => void;
  },
): void {
  const originalDownload = executor.download.bind(executor) as DownloadFn;
  executor.download = async (url, destination, options) =>
    downloadWithGithubMirrorFallback(
      url,
      (candidate) => originalDownload(candidate, destination, options),
      {
        preferMirrors: deps.shouldPreferMirrors(),
        onAttemptError: deps.onAttemptError,
      },
    );

  if (typeof executor.downloadToBuffer === "function") {
    const originalDownloadToBuffer = executor.downloadToBuffer.bind(executor) as DownloadToBufferFn;
    executor.downloadToBuffer = async (url, options) =>
      downloadWithGithubMirrorFallback(
        url,
        (candidate) => originalDownloadToBuffer(candidate, options),
        {
          preferMirrors: deps.shouldPreferMirrors(),
          onAttemptError: deps.onAttemptError,
        },
      );
  }

  if (typeof executor.request === "function") {
    const originalRequest = executor.request.bind(executor) as RequestFn;
    executor.request = async (options, cancellationToken, data) => {
      const originalUrl = requestOptionsToUrl(options);
      if (!originalUrl || !isGithubUrl(originalUrl)) {
        return originalRequest(options, cancellationToken, data);
      }

      return downloadWithGithubMirrorFallback(
        originalUrl,
        (candidate) =>
          originalRequest(applyUrlToRequestOptions(options, candidate), cancellationToken, data),
        {
          preferMirrors: deps.shouldPreferMirrors(),
          onAttemptError: deps.onAttemptError,
        },
      );
    };
  }
}
