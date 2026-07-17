import { webContents as allWebContents, type WebContents } from "electron";
import { PASEO_BROWSER_PROFILE_PARTITION } from "../browser-profile.js";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  isAllowedBrowserWebviewUrl,
  PendingBrowserWindowOpenRequests,
} from "./window-open.js";
import { PaseoBrowserWebviewRegistry } from "./registry.js";

export {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  PendingBrowserWindowOpenRequests,
};

export const BROWSER_FOUND_IN_PAGE_EVENT = "paseo:event:browser-found-in-page";

const browserRegistry = new PaseoBrowserWebviewRegistry();
const ownerWebContentsIdsByBrowserId = new Map<string, number>();
const activeFindBrowserIdsByOwnerWebContentsId = new Map<number, string>();
const ownerFoundInPageListenerWebContentsIds = new Set<number>();

interface BrowserWebContentsIdentity {
  readonly id: number;
  isDestroyed(): boolean;
}

interface RegisteredBrowserWebContents extends BrowserWebContentsIdentity {
  readonly hostWebContents: BrowserWebContentsIdentity | null;
  readonly session: object;
  setBackgroundThrottling(allowed: boolean): void;
  once(event: "destroyed", listener: () => void): void;
}

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

interface RegisterAttachedBrowserInput extends AttachedBrowserRegistration {
  sender: BrowserWebContentsIdentity;
  profileSession: object;
  findWebContents(webContentsId: number): RegisteredBrowserWebContents | null;
}

export function isPaseoBrowserWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return (
    isAllowedBrowserWebviewUrl(input.src) && input.partition === PASEO_BROWSER_PROFILE_PARTITION
  );
}

export function listRegisteredPaseoBrowserIds(): string[] {
  return browserRegistry.listBrowserIds();
}

export function getPaseoBrowserWebviewRegistry(): PaseoBrowserWebviewRegistry {
  return browserRegistry;
}

function ensureOwnerFoundInPageListener(ownerContents: WebContents): void {
  if (ownerFoundInPageListenerWebContentsIds.has(ownerContents.id)) {
    return;
  }
  ownerFoundInPageListenerWebContentsIds.add(ownerContents.id);
  const handleFoundInPage = (_event: Electron.Event, result: Electron.Result): void => {
    const browserId = activeFindBrowserIdsByOwnerWebContentsId.get(ownerContents.id);
    if (!browserId || ownerContents.isDestroyed()) {
      return;
    }
    ownerContents.send(BROWSER_FOUND_IN_PAGE_EVENT, {
      browserId,
      requestId: result.requestId,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    });
    if (result.finalUpdate) {
      activeFindBrowserIdsByOwnerWebContentsId.delete(ownerContents.id);
    }
  };
  ownerContents.on("found-in-page", handleFoundInPage);
  ownerContents.once("destroyed", () => {
    ownerContents.removeListener("found-in-page", handleFoundInPage);
    ownerFoundInPageListenerWebContentsIds.delete(ownerContents.id);
    activeFindBrowserIdsByOwnerWebContentsId.delete(ownerContents.id);
  });
}

export function preparePaseoBrowserWebContents(contents: RegisteredBrowserWebContents): void {
  const webContentsId = contents.id;
  contents.setBackgroundThrottling(false);
  contents.once("destroyed", () => {
    browserRegistry.unregisterWebContents(webContentsId);
  });
}

export function registerAttachedPaseoBrowser(input: RegisterAttachedBrowserInput): boolean {
  const guest = input.findWebContents(input.webContentsId);
  if (
    !guest ||
    guest.isDestroyed() ||
    guest.hostWebContents !== input.sender ||
    guest.session !== input.profileSession
  ) {
    return false;
  }

  browserRegistry.registerWebContents({
    webContentsId: input.webContentsId,
    browserId: input.browserId,
    hostWebContentsId: input.sender.id,
  });
  browserRegistry.registerWorkspace({
    browserId: input.browserId,
    workspaceId: input.workspaceId,
  });
  // fork(find-in-page): 记录 host WebContents 作为 owner，供 setActivePaseoBrowserFind 挂 found-in-page 监听。
  ownerWebContentsIdsByBrowserId.set(input.browserId, input.sender.id);
  return true;
}

export function getPaseoBrowserIdForWebContents(
  contents: BrowserWebContentsIdentity | null,
): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserRegistry.getBrowserIdForWebContents(contents.id);
}

export function unregisterPaseoBrowser(browserId: string): void {
  browserRegistry.unregisterBrowser(browserId);
  // fork(find-in-page): 清理该 browser 的 owner 映射与激活的查找状态。
  const ownerContentsId = ownerWebContentsIdsByBrowserId.get(browserId);
  ownerWebContentsIdsByBrowserId.delete(browserId);
  if (
    ownerContentsId &&
    activeFindBrowserIdsByOwnerWebContentsId.get(ownerContentsId) === browserId
  ) {
    activeFindBrowserIdsByOwnerWebContentsId.delete(ownerContentsId);
  }
}

export function unregisterPaseoBrowserFromHost(hostWebContentsId: number, browserId: string): void {
  browserRegistry.unregisterBrowserFromHost(hostWebContentsId, browserId);
}

export function unregisterPaseoBrowserHost(hostWebContentsId: number): void {
  browserRegistry.unregisterHostWebContents(hostWebContentsId);
}

export function getPaseoBrowserWorkspaceId(browserId: string): string | null {
  return browserRegistry.getWorkspaceId(browserId);
}

export function listRegisteredPaseoBrowserIdsForWorkspace(workspaceId: string): string[] {
  return browserRegistry.listBrowserIdsForWorkspace(workspaceId);
}

export function setWorkspaceActivePaseoBrowserId(input: {
  hostWebContentsId: number;
  workspaceId: string;
  browserId: string | null;
}): void {
  browserRegistry.setWorkspaceActiveBrowser(input);
}

export function getWorkspaceActivePaseoBrowserId(workspaceId: string): string | null {
  return browserRegistry.getMostRecentActiveBrowserIdForWorkspace(workspaceId);
}

export function getWorkspaceActivePaseoBrowserIdForHostWindow(
  workspaceId: string,
  hostWebContentsId: number,
): string | null {
  return browserRegistry.getActiveBrowserIdForWorkspaceInHostWindow(hostWebContentsId, workspaceId);
}

export function getPaseoBrowserWebContentsForHostWindow(
  browserId: string,
  hostWebContentsId: number,
): WebContents | null {
  const contentsId = browserRegistry.getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId,
    browserId,
  );
  if (contentsId === null) {
    return null;
  }
  const contents = allWebContents.fromId(contentsId);
  if (contents && !contents.isDestroyed()) {
    return contents;
  }
  browserRegistry.unregisterWebContents(contentsId);
  return null;
}

export function setActivePaseoBrowserFind(browserId: string): void {
  const ownerContentsId = ownerWebContentsIdsByBrowserId.get(browserId);
  if (!ownerContentsId) {
    return;
  }
  const ownerContents = allWebContents.fromId(ownerContentsId);
  if (!ownerContents || ownerContents.isDestroyed()) {
    return;
  }
  ensureOwnerFoundInPageListener(ownerContents);
  activeFindBrowserIdsByOwnerWebContentsId.set(ownerContents.id, browserId);
}

export function clearActivePaseoBrowserFind(browserId: string): void {
  const ownerContentsId = ownerWebContentsIdsByBrowserId.get(browserId);
  if (!ownerContentsId) {
    return;
  }
  if (activeFindBrowserIdsByOwnerWebContentsId.get(ownerContentsId) === browserId) {
    activeFindBrowserIdsByOwnerWebContentsId.delete(ownerContentsId);
  }
}

export function getActivePaseoBrowserWebContentsForHostWindow(
  hostWebContentsId: number,
): WebContents | null {
  const browserId = browserRegistry.getActiveBrowserIdForHostWindow(hostWebContentsId);
  if (!browserId) {
    return null;
  }
  const contentsId = browserRegistry.getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId,
    browserId,
  );
  if (contentsId === null) {
    return null;
  }
  const contents = allWebContents.fromId(contentsId);
  if (contents && !contents.isDestroyed()) {
    return contents;
  }
  browserRegistry.unregisterWebContents(contentsId);
  return null;
}

function preventUnsafeBrowserWebviewNavigation(
  event: { preventDefault: () => void },
  url: string | undefined,
): void {
  if (!isAllowedBrowserWebviewUrl(url)) {
    event.preventDefault();
  }
}

export function registerBrowserWebviewNavigationGuards(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-frame-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-redirect", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
}
