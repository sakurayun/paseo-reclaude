/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewTabLauncherProvider,
  useWorkspaceTabLaunchCatalog,
  type NewTabLauncher,
  type WorkspaceTabLaunchGroup,
} from "./index";

vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("lucide-react-native", () => ({
  Cable: () => null,
  Globe: () => null,
  History: () => null,
  SquarePen: () => null,
  SquareTerminal: () => null,
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: null }),
}));
vi.mock("@/plugins/icons", () => ({ pluginIconComponent: () => () => null }));
vi.mock("@/plugins/registry", () => ({ useInstalledPlugins: () => [] }));
vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: (kind: string) => ({
    presentation: { label: () => kind, icon: () => null },
  }),
}));

let root: Root;
let container: HTMLDivElement;
let groups: readonly WorkspaceTabLaunchGroup[];
const launch = vi.fn();
const launcher: NewTabLauncher = {
  workspaceId: "workspace-current",
  showChanges: true,
  showPullRequest: true,
  showBrowser: true,
  terminalDisabled: false,
  launch,
};
type CatalogInput = Parameters<typeof useWorkspaceTabLaunchCatalog>[0];
function Catalog({ input }: { input: CatalogInput }) {
  groups = useWorkspaceTabLaunchCatalog(input);
  return null;
}
function catalogInput(overrides: Partial<CatalogInput>): CatalogInput {
  return {
    serverId: "server",
    purpose: "primary",
    host: "main",
    surface: "menu",
    ...overrides,
  };
}
function renderCatalog(overrides: Partial<CatalogInput> = {}) {
  const input = catalogInput(overrides);
  act(() =>
    root.render(
      <NewTabLauncherProvider value={launcher}>
        <Catalog input={input} />
      </NewTabLauncherProvider>,
    ),
  );
  return groups.flatMap((group) => group.items);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  launch.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("fork panel launch entries", () => {
  it.each(["primary", "supporting"] as const)(
    "launches sessions for the current workspace from %s menus",
    (purpose) => {
      const item = renderCatalog({ purpose }).find((entry) => entry.id === "sessions");
      expect(item?.panelKind).toBe("sessions");
      expect(item?.label).not.toContain("sessions.title");
      item!.launch({ kind: "open", paneId: "pane-a" });
      expect(launch).toHaveBeenCalledWith(
        {
          kind: "target",
          target: { kind: "sessions", workspaceId: "workspace-current" },
        },
        { kind: "open", paneId: "pane-a" },
      );
    },
  );
  it("launches port forwards through the existing replacement destination", () => {
    const item = renderCatalog({ surface: "panel" }).find((entry) => entry.id === "port-forwards");
    expect(item?.panelKind).toBe("port-forwards");
    item!.launch({ kind: "replace", tabId: "new-tab" });
    expect(launch).toHaveBeenCalledWith(
      { kind: "target", target: { kind: "port-forwards" } },
      { kind: "replace", tabId: "new-tab" },
    );
  });
  it("respects explorer host support", () => {
    const ids = renderCatalog({ host: "explorer", purpose: "supporting" }).map((item) => item.id);
    expect(ids).toContain("sessions");
    expect(ids).not.toContain("port-forwards");
  });
  it("does not offer a second singleton in the same pane menu", () => {
    const ids = renderCatalog({
      panePanelKinds: ["sessions", "port-forwards"],
    }).map((item) => item.id);
    expect(ids).not.toContain("sessions");
    expect(ids).not.toContain("port-forwards");
  });
});
