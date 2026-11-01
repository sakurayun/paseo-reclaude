/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "@/file-pane/pane";
import { PaneProvider, type PaneContextValue } from "@/panels/pane-context";
import type { FileHandleSnapshot } from "@/file-panels/file/handle";

const m = vi.hoisted(() => ({
  snapshot: { status: "loading" } as FileHandleSnapshot,
  panel: null as null | { id: string },
  outsideKind: null as null | "directory" | "file" | "unknown",
  connected: true,
  active: true,
  visible: true,
  local: false,
  electron: false,
  file: { path: "/repo/src/example.ts" },
  useHandle: vi.fn(),
  choice: vi.fn(),
  view: vi.fn(),
  publish: vi.fn(),
  retry: vi.fn(),
  holdWrites: vi.fn(),
  download: vi.fn(),
  reveal: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  openExplorer: vi.fn(),
  listing: vi.fn(),
  select: vi.fn(),
  expand: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => m.active,
}));
vi.mock("@/hooks/use-app-visible", () => ({
  useAppActivelyVisible: () => m.visible,
}));
vi.mock("@/file-panels/file", () => ({
  useFileHandle: (input: unknown) => {
    m.useHandle(input);
    return { file: m.file, retry: m.retry, holdWrites: m.holdWrites };
  },
  useFileHandleSnapshot: () => m.snapshot,
}));
vi.mock("@/file-panels/loading", () => ({
  FilePanelLoading: () => <span data-testid="file-loading" />,
}));
vi.mock("@/file-panels", () => ({
  useFilePanelChoice: (input: unknown) => {
    m.choice(input);
    return { panel: m.panel, choice: null };
  },
  FilePanelPicker: () => <span data-testid="file-picker" />,
  FilePanelView: (props: unknown) => {
    m.view(props);
    return <span data-testid="plugin-panel" />;
  },
}));
vi.mock("@/file-pane/use-outside-path-kind", () => ({
  useOutsidePathKind: () => m.outsideKind,
}));
vi.mock("@/file-pane/directory-browser", () => ({
  DirectoryBrowser: ({
    absolutePath,
    onOpenFile,
  }: {
    absolutePath: string;
    onOpenFile: (path: string) => void;
  }) => {
    const handleOpen = React.useCallback(
      () => onOpenFile(`${absolutePath}/readme.md`),
      [absolutePath, onOpenFile],
    );
    return (
      <button type="button" data-testid="directory-browser" onClick={handleOpen}>
        {absolutePath}
      </button>
    );
  },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/constants/platform", () => ({ getIsElectron: () => m.electron }));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (state: unknown) => unknown) =>
    selector({ setExpandedPathsForWorkspace: m.expand }),
}));
vi.mock("@/hooks/use-file-explorer-actions", () => ({
  useFileExplorerActions: () => ({
    workspaceStateKey: "server:workspace",
    requestDirectoryListing: m.listing,
    selectExplorerEntry: m.select,
  }),
}));
vi.mock("@/hooks/use-file-download", () => ({
  useFileDownload: () => m.download,
}));
vi.mock("@/hooks/use-is-local-daemon", () => ({
  useIsLocalDaemon: () => m.local,
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: m.toastError }),
}));
vi.mock("@/desktop/shell", () => ({ revealItemInFolder: m.reveal }));
vi.mock("@/desktop/host", () => ({ isElectronRuntimeMac: () => false }));
vi.mock("@/panels/panel-instance-attributes", () => ({
  usePublishPanelInstanceAttributes: m.publish,
}));
vi.mock("@/workspace-tabs/explorer-sidebar", () => ({
  openExplorerSidebarView: m.openExplorer,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ sessions: { server: { client: m.connected ? {} : null } } }),
}));
const context: PaneContextValue = {
  serverId: "server",
  workspaceId: "workspace",
  paneInstanceId: "file-pane",
  host: "main",
  tabId: "file",
  target: { kind: "file", path: "src/example.ts" },
  state: { scrollTop: 42 },
  openTab: vi.fn(),
  openPreferredTarget: vi.fn(),
  closeCurrentTab: vi.fn(),
  retargetCurrentTab: vi.fn(),
  setCurrentTabState: vi.fn(),
  openFileInWorkspace: vi.fn(),
  openImportSheet: vi.fn(),
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.snapshot = { status: "loading" };
  m.panel = null;
  m.outsideKind = null;
  m.connected = m.active = m.visible = true;
  m.local = m.electron = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function fileLocation(path: string, lineStart?: number) {
  return { path, lineStart };
}
function render(path = "src/example.ts", lineStart?: number, revision = 0) {
  const location = fileLocation(path, lineStart);
  act(() =>
    root.render(
      <PaneProvider value={context}>
        <FilePane
          serverId="server"
          workspaceId="workspace"
          workspaceRoot="/repo"
          location={location}
          navigationRevision={revision}
        />
      </PaneProvider>,
    ),
  );
}
function click(id: string) {
  const button = container.querySelector(`[data-testid="${id}"]`);
  expect(button).not.toBeNull();
  act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function ready(kind: "text" | "image" | "binary" = "text", size = 1200) {
  m.snapshot = {
    status: "ready",
    kind,
    size,
    modifiedAt: "2026-11-01T00:00:00.000Z",
    mimeType: "application/octet-stream",
  };
}
describe("FilePane plugin architecture", () => {
  it.each([
    ["src/example.ts", "text", "source"],
    ["README.md", "text", "markdown"],
    ["image.png", "image", "image"],
  ] as const)("delegates %s with navigation and tab state", (path, kind, id) => {
    ready(kind);
    m.panel = { id };
    render(path, 12, 3);
    expect(container.querySelector('[data-testid="plugin-panel"]')).not.toBeNull();
    expect(m.choice).toHaveBeenLastCalledWith(
      expect.objectContaining({ path, fileKind: kind, lineNavigation: 3 }),
    );
    expect(m.view).toHaveBeenLastCalledWith(
      expect.objectContaining({
        panel: { id },
        file: m.file,
        params: { path, lineStart: 12, lineEnd: undefined },
        revision: 3,
        tab: expect.objectContaining({
          state: context.state,
          setState: context.setCurrentTabState,
        }),
      }),
    );
    const props = m.view.mock.lastCall![0] as {
      tab: { setModified: (modified: boolean) => void };
    };
    act(() => props.tab.setModified(true));
    expect(m.publish).toHaveBeenLastCalledWith({
      modified: true,
      suspendPendingSave: m.holdWrites,
    });
  });
  it("observes only while panel and app are visible", () => {
    render();
    expect(m.useHandle).toHaveBeenLastCalledWith(expect.objectContaining({ observing: true }));
    m.active = false;
    render();
    expect(m.useHandle).toHaveBeenLastCalledWith(expect.objectContaining({ observing: false }));
    m.active = true;
    m.visible = false;
    render();
    expect(m.useHandle).toHaveBeenLastCalledWith(expect.objectContaining({ observing: false }));
    expect(container.querySelector('[data-testid="file-loading"]')).not.toBeNull();
  });
  it("renders a missing file with retry", () => {
    m.snapshot = { status: "missing" };
    render();
    const retry = container.querySelector("button");
    expect(retry).not.toBeNull();
    act(() => retry!.click());
    expect(m.retry).toHaveBeenCalledOnce();
  });
  it("shows disconnected state without mounting a plugin", () => {
    ready();
    m.panel = { id: "source" };
    m.connected = false;
    render();
    expect(container.querySelector('[data-testid="plugin-panel"]')).toBeNull();
    expect(container.textContent).toContain("not connected");
  });
  it("keeps binary size and remote download", () => {
    ready("binary", 2048);
    render("build/app.bin");
    expect(container.querySelector('[data-testid="file-binary-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("2.0 KB");
    click("file-binary-download");
    expect(m.download).toHaveBeenCalledWith({
      fileName: "app.bin",
      path: "build/app.bin",
    });
    expect(container.querySelector('[data-testid="file-binary-reveal"]')).toBeNull();
  });
  it("reveals local desktop binaries by absolute path", () => {
    ready("binary");
    m.local = m.electron = true;
    render("/repo/build/app.bin");
    click("file-binary-reveal");
    expect(m.reveal).toHaveBeenCalledWith("/repo/build/app.bin");
  });
  it("opens workspace directories in explorer", () => {
    render("src/nested/");
    expect(container.querySelector('[data-testid="file-directory-redirect"]')).not.toBeNull();
    expect(m.openExplorer).toHaveBeenCalledWith({
      isCompact: false,
      view: "files",
      workspaceKey: "server:workspace",
    });
    expect(m.listing).toHaveBeenCalledWith("src/nested", {
      recordHistory: true,
      setCurrentPath: true,
    });
  });
  it("recovers directories reported by string errors", () => {
    m.snapshot = { status: "error", error: "Path is not a file" };
    render("src/nested");
    expect(container.querySelector('[data-testid="file-directory-redirect"]')).not.toBeNull();
    expect(m.select).toHaveBeenCalledWith("src/nested");
  });
  it("browses outside directories and opens selected files", () => {
    m.outsideKind = "directory";
    render("/outside");
    click("directory-browser");
    expect(context.openFileInWorkspace).toHaveBeenCalledWith({
      location: { path: "/outside/readme.md" },
      disposition: "main",
    });
    expect(m.useHandle).toHaveBeenLastCalledWith(expect.objectContaining({ target: null }));
  });
});
