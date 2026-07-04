import { webContents as allWebContents, type WebContents } from "electron";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  handleBrowserWindowOpenRequest,
  isAllowedBrowserWebviewUrl,
} from "./window-open.js";
import { PaseoBrowserWebviewRegistry, type BrowserWorkspaceRegistration } from "./registry.js";

export { BROWSER_NEW_TAB_REQUEST_EVENT, handleBrowserWindowOpenRequest };
export type { BrowserWorkspaceRegistration };

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
  setBackgroundThrottling(allowed: boolean): void;
  once(event: "destroyed", listener: () => void): void;
}

function getBrowserIdFromWebviewPartition(partition: string | undefined): string | null {
  const prefix = "persist:paseo-browser-";
  if (!partition?.startsWith(prefix)) {
    return null;
  }
  const browserId = partition.slice(prefix.length).trim();
  return browserId.length > 0 ? browserId : null;
}

export function readBrowserIdFromWebviewAttach(input: {
  src?: string;
  partition?: string;
}): string | null {
  if (!isAllowedBrowserWebviewUrl(input.src)) {
    return null;
  }
  return getBrowserIdFromWebviewPartition(input.partition);
}

export function listRegisteredPaseoBrowserIds(): string[] {
  return browserRegistry
    .listBrowserIds()
    .filter((browserId) => getPaseoBrowserWebContents(browserId));
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

export function registerPaseoBrowserWebContents(
  contents: RegisteredBrowserWebContents,
  browserId: string,
  ownerContents?: WebContents,
): void {
  contents.setBackgroundThrottling(false);
  browserRegistry.registerWebContents({ webContentsId: contents.id, browserId });
  if (ownerContents && !ownerContents.isDestroyed()) {
    ownerWebContentsIdsByBrowserId.set(browserId, ownerContents.id);
    ensureOwnerFoundInPageListener(ownerContents);
  }
  contents.once("destroyed", () => {
    browserRegistry.unregisterWebContents(contents.id);
    const ownerContentsId = ownerWebContentsIdsByBrowserId.get(browserId);
    ownerWebContentsIdsByBrowserId.delete(browserId);
    if (
      ownerContentsId &&
      activeFindBrowserIdsByOwnerWebContentsId.get(ownerContentsId) === browserId
    ) {
      activeFindBrowserIdsByOwnerWebContentsId.delete(ownerContentsId);
    }
  });
}

export function getPaseoBrowserIdForWebContents(
  contents: BrowserWebContentsIdentity | null,
): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserRegistry.getBrowserIdForWebContents(contents.id);
}

export function registerPaseoBrowserWorkspace(input: BrowserWorkspaceRegistration): void {
  browserRegistry.registerWorkspace(input);
}

export function unregisterPaseoBrowser(browserId: string): void {
  browserRegistry.unregisterBrowser(browserId);
}

export function getPaseoBrowserWorkspaceId(browserId: string): string | null {
  return browserRegistry.getWorkspaceId(browserId);
}

export function listRegisteredPaseoBrowserIdsForWorkspace(workspaceId: string): string[] {
  return browserRegistry
    .listBrowserIdsForWorkspace(workspaceId)
    .filter((browserId) => getPaseoBrowserWebContents(browserId));
}

export function setWorkspaceActivePaseoBrowserId(input: {
  workspaceId: string;
  browserId: string | null;
}): void {
  browserRegistry.setWorkspaceActiveBrowser(input);
}

export function getWorkspaceActivePaseoBrowserId(workspaceId: string): string | null {
  return browserRegistry.getWorkspaceActiveBrowserId(workspaceId);
}

export function getPaseoBrowserWebContents(browserId: string): WebContents | null {
  const contentsId = browserRegistry.getWebContentsIdForBrowser(browserId);
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

export function getWorkspaceActivePaseoBrowserWebContents(workspaceId: string): WebContents | null {
  const activeBrowserId = getWorkspaceActivePaseoBrowserId(workspaceId);
  return activeBrowserId ? getPaseoBrowserWebContents(activeBrowserId) : null;
}

export function getMostRecentWorkspaceActivePaseoBrowserWebContents(): WebContents | null {
  const browserId = browserRegistry.getMostRecentWorkspaceActiveBrowserId();
  return browserId ? getPaseoBrowserWebContents(browserId) : null;
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
