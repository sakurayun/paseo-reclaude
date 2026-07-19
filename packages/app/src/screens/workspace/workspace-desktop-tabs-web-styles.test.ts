// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  installWorkspaceDesktopTabsWebStyles,
  WORKSPACE_DESKTOP_TABS_STYLE_ID,
} from "@/screens/workspace/workspace-desktop-tabs-web-styles.web";

afterEach(() => {
  document.getElementById(WORKSPACE_DESKTOP_TABS_STYLE_ID)?.remove();
});

describe("workspace desktop tab interaction styles", () => {
  it("installs pseudo-class rules for tab, close, and row actions", () => {
    const cleanup = installWorkspaceDesktopTabsWebStyles();
    const css = document.getElementById(WORKSPACE_DESKTOP_TABS_STYLE_ID)?.textContent ?? "";

    expect(css).toContain('[data-workspace-tab="true"]:hover');
    expect(css).toContain('[data-workspace-tab-close="true"]:not([aria-disabled="true"]):active');
    expect(css).toContain('[data-workspace-tab-action="true"]:not([aria-disabled="true"]):hover');

    cleanup();
    expect(document.getElementById(WORKSPACE_DESKTOP_TABS_STYLE_ID)).toBeNull();
  });
});
