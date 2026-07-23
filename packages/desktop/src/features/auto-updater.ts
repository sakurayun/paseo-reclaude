import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { UUID } from "builder-util-runtime";
import { autoUpdater } from "electron-updater";
import {
  createAppUpdateService,
  type AppUpdateCheckResult,
  type AppUpdateInstallResult,
  type AppUpdateRuntime,
  type AppUpdateRuntimeConfiguration,
  type RuntimeUpdateCheckResult,
  type RuntimeUpdateInfo,
} from "./app-update-service.js";
import {
  bucketFromStagingUserId,
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
} from "./app-update-rollout.js";
import {
  patchHttpExecutorWithGithubMirrors,
  shouldPreferGithubMirrors,
  type GithubMirrorHttpExecutorTarget,
} from "./github-release-mirrors.js";

export {
  bucketFromStagingUserId,
  rolloutManifestSchema,
  shouldAdmitAppUpdate,
  type AppReleaseChannel,
  type AppUpdateCheckIntent,
  type AppUpdateCheckResult,
  type AppUpdateInstallResult,
};

let cachedStagingUserIdPromise: Promise<string> | null = null;

export function shouldAdmitToRollout(args: {
  channel: AppReleaseChannel;
  rolloutHours: number | undefined;
  releaseDate: string | undefined;
  now: number;
  bucket: number;
}): boolean {
  return shouldAdmitAppUpdate({ ...args, intent: "automatic" });
}

export async function resolveStagingUserId(filePath: string): Promise<string> {
  try {
    const id = (await readFile(filePath, "utf8")).trim();
    if (UUID.check(id)) {
      return id;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[auto-updater] Couldn't read staging user ID, creating a blank one: ${error}`);
    }
  }

  const id = UUID.v5(randomBytes(4096), UUID.OID);

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, id);
  } catch (error) {
    console.warn(`[auto-updater] Couldn't write out staging user ID: ${error}`);
  }

  return id;
}

export function getStagingUserId(): Promise<string> {
  if (cachedStagingUserIdPromise == null) {
    cachedStagingUserIdPromise = resolveStagingUserId(
      path.join(app.getPath("userData"), ".updaterId"),
    );
  }
  return cachedStagingUserIdPromise;
}

export function shouldInstallAppUpdateOnQuit(input: {
  platform: NodeJS.Platform;
  isAppImage: boolean;
}): boolean {
  // AppImage's no-relaunch install path blocks while launching the replacement
  // binary, which can hang after the running file has already been replaced.
  return !(input.platform === "linux" && input.isAppImage);
}

export function detectMainlandChinaPreferMirrors(input?: {
  locale?: string | null;
  locales?: readonly string[] | null;
  timeZone?: string | null;
}): boolean {
  let locale = input?.locale ?? null;
  let locales = input?.locales ?? null;
  let timeZone = input?.timeZone ?? null;

  if (locale == null || locales == null || timeZone == null) {
    try {
      locale ??= typeof app.getLocale === "function" ? app.getLocale() : null;
      locales ??=
        typeof app.getPreferredSystemLanguages === "function"
          ? app.getPreferredSystemLanguages()
          : null;
    } catch {
      // app may be unavailable in unit tests.
    }
    try {
      timeZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      timeZone ??= null;
    }
  }

  return shouldPreferGithubMirrors({ locale, locales, timeZone });
}

class ElectronAppUpdateRuntime implements AppUpdateRuntime {
  private configured = false;
  private mirrorDownloadPatched = false;

  configure(input: AppUpdateRuntimeConfiguration): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoRunAppAfterInstall = true;
    // Paseo revalidates the current manifest before explicitly installing on quit.
    // Electron's built-in handler would install an older download without checking
    // whether a newer release has superseded it.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = input.releaseChannel === "beta";
    autoUpdater.channel = input.releaseChannel === "beta" ? "beta" : "latest";
    autoUpdater.allowDowngrade = false;
    autoUpdater.isUserWithinRollout = async (info) => {
      try {
        return await input.shouldAdmitUpdate(info as RuntimeUpdateInfo);
      } catch {
        return true;
      }
    };

    // Install/restart downloads (settings + sidebar callout) go through this
    // HTTP executor. In mainland China, GitHub is often unreachable, so patch
    // downloads to walk a short list of public acceleration mirrors first.
    this.ensureGithubMirrorDownloadPatch();

    if (this.configured) return;
    this.configured = true;

    autoUpdater.on("update-available", (info) => {
      input.onUpdateAvailable(info as RuntimeUpdateInfo);
    });
    autoUpdater.on("update-downloaded", (info) => {
      input.onUpdateDownloaded(info as RuntimeUpdateInfo);
    });
    autoUpdater.on("update-not-available", () => {
      input.onUpdateNotAvailable();
    });
    autoUpdater.on("error", (error) => {
      input.onError(error);
    });
  }

  private ensureGithubMirrorDownloadPatch(): void {
    if (this.mirrorDownloadPatched) {
      return;
    }

    // electron-updater constructs the executor lazily on first configure/check.
    // Touching it once guarantees the property exists so we can wrap downloads.
    const executor = (autoUpdater as unknown as { httpExecutor?: GithubMirrorHttpExecutorTarget })
      .httpExecutor;
    if (!executor || typeof executor.download !== "function") {
      return;
    }

    patchHttpExecutorWithGithubMirrors(executor, {
      shouldPreferMirrors: () => detectMainlandChinaPreferMirrors(),
      onAttemptError: ({ candidate, error, remaining }) => {
        if (remaining <= 0) {
          return;
        }
        console.warn(
          `[auto-updater] GitHub download via ${candidate.href} failed; trying next mirror:`,
          error,
        );
      },
    });
    this.mirrorDownloadPatched = true;
  }

  async checkForUpdates(): Promise<RuntimeUpdateCheckResult | null> {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return null;
    return {
      isUpdateAvailable: result.isUpdateAvailable,
      updateInfo: result.updateInfo as RuntimeUpdateInfo,
    };
  }

  downloadUpdate(): Promise<unknown> {
    return autoUpdater.downloadUpdate();
  }

  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
    autoUpdater.autoRunAppAfterInstall = isForceRunAfter;
    autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
  }
}

const appUpdateService = createAppUpdateService({
  runtime: new ElectronAppUpdateRuntime(),
  isPackaged: () => app.isPackaged,
  now: () => Date.now(),
  bucket: async () => bucketFromStagingUserId(await getStagingUserId()),
  reportCheckError: (error) => {
    console.error("[auto-updater] Failed to check for updates:", error);
  },
  reportRuntimeError: (error) => {
    console.error("[auto-updater] Updater event failed:", error);
  },
  reportInstallError: (message) => {
    console.error("[auto-updater] Failed to download/install update:", message);
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkForAppUpdate({
  currentVersion,
  releaseChannel,
  intent,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  intent: AppUpdateCheckIntent;
}): Promise<AppUpdateCheckResult> {
  return appUpdateService.checkForAppUpdate({ currentVersion, releaseChannel, intent });
}

export async function downloadAndInstallUpdate(
  {
    currentVersion,
    releaseChannel,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
  },
  onBeforeQuit?: () => Promise<void>,
): Promise<AppUpdateInstallResult> {
  return appUpdateService.downloadAndInstallUpdate(
    { currentVersion, releaseChannel },
    onBeforeQuit,
  );
}

export async function installAppUpdateOnQuit({
  currentVersion,
  releaseChannel,
  signal,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  signal: AbortSignal;
}): Promise<boolean> {
  if (
    !shouldInstallAppUpdateOnQuit({
      platform: process.platform,
      isAppImage: Boolean(process.env.APPIMAGE),
    })
  ) {
    return false;
  }

  return appUpdateService.installUpdateOnQuit({ currentVersion, releaseChannel, signal });
}
