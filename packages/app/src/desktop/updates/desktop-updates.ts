import { isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";

export interface DesktopAppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

export interface DesktopAppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export interface DesktopRuntimeInfo {
  appVersion: string | null;
  runningUnderARM64Translation: boolean;
}

export type DesktopReleaseChannel = "stable" | "beta";
export type DesktopAppUpdateCheckIntent = "automatic" | "manual";

export interface LocalDaemonUpdateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LocalDaemonVersionResult {
  version: string | null;
  error: string | null;
}

/** Matches packages/desktop/electron-builder.yml publish.owner/repo. */
const RELEASE_OWNER = "sakurayun";
const RELEASE_REPO = "paseo-reclaude";
const RELEASE_DOWNLOAD_BASE_URL = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download`;

/**
 * Public GitHub acceleration mirrors commonly used in mainland China.
 * Keep in sync with packages/desktop/src/features/github-release-mirrors.ts.
 */
const GITHUB_RELEASE_MIRROR_PREFIXES = [
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://mirror.ghproxy.com/",
  "https://ghproxy.net/",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

function collectNavigatorLocales(): string[] {
  try {
    if (typeof navigator === "undefined") {
      return [];
    }
    const values = [navigator.language, ...(navigator.languages ?? [])];
    return values.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

function isMainlandChinaLocale(locale: string): boolean {
  const normalized = locale.trim().toLowerCase().replaceAll("_", "-");
  return (
    normalized === "zh-cn" ||
    normalized === "zh-hans" ||
    normalized === "zh-hans-cn" ||
    normalized.startsWith("zh-cn-") ||
    normalized.startsWith("zh-hans-")
  );
}

export function shouldPreferGithubReleaseMirrors(input?: {
  locale?: string | null;
  locales?: readonly string[] | null;
  timeZone?: string | null;
}): boolean {
  const timeZone = input?.timeZone?.trim() || resolveDefaultTimeZone();
  if (timeZone === "Asia/Shanghai" || timeZone === "Asia/Urumqi") {
    return true;
  }

  const candidates = [...(input?.locale ? [input.locale] : []), ...(input?.locales ?? [])];
  if (candidates.length === 0) {
    candidates.push(...collectNavigatorLocales());
  }

  return candidates.some(isMainlandChinaLocale);
}

/**
 * When mainland China is detected, rewrite a github.com asset URL through the
 * first acceleration mirror so browser-opened downloads (e.g. Rosetta callout)
 * don't hit github.com directly.
 */
export function preferGithubReleaseMirrorUrl(
  url: string,
  options?: {
    preferMirrors?: boolean;
  },
): string {
  const preferMirrors = options?.preferMirrors ?? shouldPreferGithubReleaseMirrors();
  if (!preferMirrors) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("github.com")) {
      return url;
    }
    return `${GITHUB_RELEASE_MIRROR_PREFIXES[0]}${parsed.href}`;
  } catch {
    return url;
  }
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberOr(defaultValue: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

export function shouldShowDesktopUpdateSection(): boolean {
  return isWeb && isElectronRuntime();
}

export function parseLocalDaemonVersionResult(raw: unknown): LocalDaemonVersionResult {
  if (!isRecord(raw)) {
    return { version: null, error: "Unexpected response from version check." };
  }

  return {
    version: toStringOrNull(raw.version),
    error: toStringOrNull(raw.error),
  };
}

export async function getLocalDaemonVersion(): Promise<LocalDaemonVersionResult> {
  const result = await invokeDesktopCommand<unknown>("get_local_daemon_version");
  return parseLocalDaemonVersionResult(result);
}

export function parseDesktopRuntimeInfo(raw: unknown): DesktopRuntimeInfo {
  if (!isRecord(raw)) {
    return {
      appVersion: null,
      runningUnderARM64Translation: false,
    };
  }

  return {
    appVersion: toStringOrNull(raw.appVersion),
    runningUnderARM64Translation: raw.runningUnderARM64Translation === true,
  };
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo> {
  const result = await invokeDesktopCommand<unknown>("desktop_get_runtime_info");
  return parseDesktopRuntimeInfo(result);
}

export async function checkDesktopAppUpdate({
  releaseChannel,
  intent,
}: {
  releaseChannel: DesktopReleaseChannel;
  intent: DesktopAppUpdateCheckIntent;
}): Promise<DesktopAppUpdateCheckResult> {
  const result = await invokeDesktopCommand<unknown>("check_app_update", {
    releaseChannel,
    intent,
  });
  if (!isRecord(result)) {
    throw new Error("Unexpected response while checking desktop updates.");
  }

  return {
    hasUpdate: result.hasUpdate === true,
    readyToInstall: result.readyToInstall === true,
    currentVersion: toStringOrNull(result.currentVersion),
    latestVersion: toStringOrNull(result.latestVersion),
    body: toStringOrNull(result.body),
    date: toStringOrNull(result.date),
    errorMessage: toStringOrNull(result.errorMessage),
  };
}

export async function installDesktopAppUpdate({
  releaseChannel,
}: {
  releaseChannel: DesktopReleaseChannel;
}): Promise<DesktopAppUpdateInstallResult> {
  const result = await invokeDesktopCommand<unknown>("install_app_update", { releaseChannel });
  if (!isRecord(result)) {
    throw new Error("Unexpected response while installing desktop update.");
  }

  return {
    installed: result.installed === true,
    version: toStringOrNull(result.version),
    message: toStringOrNull(result.message) ?? i18n.t("desktop.updates.status.installed"),
  };
}

export async function runLocalDaemonUpdate(): Promise<LocalDaemonUpdateResult> {
  const result = await invokeDesktopCommand<unknown>("run_local_daemon_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while updating local daemon.");
  }

  return {
    exitCode: toNumberOr(1, result.exitCode),
    stdout: toStringOrEmpty(result.stdout),
    stderr: toStringOrEmpty(result.stderr),
  };
}

export function normalizeVersionForComparison(version: string | null | undefined): string | null {
  const value = version?.trim();
  if (!value) {
    return null;
  }

  return value.replace(/^v/i, "");
}

export function isVersionMismatch(
  appVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const app = normalizeVersionForComparison(appVersion);
  const daemon = normalizeVersionForComparison(daemonVersion);

  if (!app || !daemon) {
    return false;
  }

  return app !== daemon;
}

export function formatVersionWithPrefix(version: string | null | undefined): string {
  const value = version?.trim();
  if (!value) {
    return "\u2014";
  }

  return value.startsWith("v") ? value : `v${value}`;
}

export function buildMacAppleSiliconDownloadUrl(
  version: string | null | undefined,
  options?: {
    preferMirrors?: boolean;
  },
): string | null {
  const normalizedVersion = normalizeVersionForComparison(version);
  if (!normalizedVersion) {
    return null;
  }

  const direct = `${RELEASE_DOWNLOAD_BASE_URL}/v${normalizedVersion}/Paseo-${normalizedVersion}-arm64.dmg`;
  return preferGithubReleaseMirrorUrl(direct, options);
}

export function buildDaemonUpdateDiagnostics(result: LocalDaemonUpdateResult): string {
  const stdout = result.stdout.length > 0 ? result.stdout : "(empty)";
  const stderr = result.stderr.length > 0 ? result.stderr : "(empty)";

  return [`Exit code: ${result.exitCode}`, "", "STDOUT:", stdout, "", "STDERR:", stderr].join("\n");
}
