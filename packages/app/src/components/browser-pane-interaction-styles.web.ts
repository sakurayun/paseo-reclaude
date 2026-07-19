import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

export const BROWSER_TOOLBAR_BUTTON_DATA_SET = {
  paseoBrowserToolbarButton: "true",
} as const;

export const BROWSER_PANE_INTERACTION_STYLE_ID = "paseo-browser-pane-interactions";

export const BROWSER_PANE_INTERACTION_CSS = `
@media (hover: hover) and (pointer: fine) {
  [data-paseo-browser-toolbar-button="true"]:not([aria-disabled="true"]):hover,
  [data-paseo-browser-toolbar-button="true"]:not([aria-disabled="true"]):active {
    background-color: var(--colors-surface2) !important;
  }
}
`;

export function installBrowserPaneInteractionStyles(): () => void {
  return installWebInteractionStyles(
    BROWSER_PANE_INTERACTION_STYLE_ID,
    BROWSER_PANE_INTERACTION_CSS,
  );
}
