// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_PANE_INTERACTION_CSS,
  BROWSER_PANE_INTERACTION_STYLE_ID,
  BROWSER_TOOLBAR_BUTTON_DATA_SET,
  installBrowserPaneInteractionStyles,
} from "./browser-pane-interaction-styles.web";

afterEach(() => {
  document.getElementById(BROWSER_PANE_INTERACTION_STYLE_ID)?.remove();
});

describe("browser pane interaction styles", () => {
  it("styles enabled toolbar buttons through CSS hover and active pseudo-classes", () => {
    expect(BROWSER_TOOLBAR_BUTTON_DATA_SET).toEqual({
      paseoBrowserToolbarButton: "true",
    });
    expect(BROWSER_PANE_INTERACTION_CSS).toContain(
      '[data-paseo-browser-toolbar-button="true"]:not([aria-disabled="true"]):hover',
    );
    expect(BROWSER_PANE_INTERACTION_CSS).toContain(
      '[data-paseo-browser-toolbar-button="true"]:not([aria-disabled="true"]):active',
    );
  });

  it("installs and removes its component-owned stylesheet", () => {
    const cleanup = installBrowserPaneInteractionStyles();

    expect(document.getElementById(BROWSER_PANE_INTERACTION_STYLE_ID)?.textContent).toBe(
      BROWSER_PANE_INTERACTION_CSS,
    );

    cleanup();
    expect(document.getElementById(BROWSER_PANE_INTERACTION_STYLE_ID)).toBeNull();
  });

  it("keeps browser toolbar visual interaction out of Pressable style callbacks", () => {
    const appRoot = process.cwd().endsWith("packages/app")
      ? process.cwd()
      : path.resolve(process.cwd(), "packages/app");
    const source = readFileSync(
      path.resolve(appRoot, "src/components/browser-pane.electron.tsx"),
      "utf8",
    );
    const toolbarSource = source.slice(
      source.indexOf("function ToolbarButton"),
      source.indexOf("const devicePreset = useMemo"),
    );

    expect(toolbarSource).toContain("BROWSER_TOOLBAR_BUTTON_DATA_SET");
    expect(toolbarSource).not.toContain("({ hovered, pressed }");
    expect(toolbarSource).not.toContain("onHoverIn");
    expect(toolbarSource).not.toContain("onHoverOut");
  });
});
