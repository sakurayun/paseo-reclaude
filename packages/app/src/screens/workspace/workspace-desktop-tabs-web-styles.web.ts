import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

export const WORKSPACE_DESKTOP_TABS_STYLE_ID = "paseo-workspace-desktop-tabs-interactions";

export const WORKSPACE_DESKTOP_TABS_CSS = `
[data-workspace-tab="true"]:hover [data-workspace-tab-label="true"] {
  color: var(--colors-foreground) !important;
}

[data-workspace-tab="true"]:hover [data-workspace-tab-icon="true"] svg {
  color: var(--colors-foreground) !important;
}

[data-workspace-tab-close="true"]:not([aria-disabled="true"]):hover,
[data-workspace-tab-close="true"]:not([aria-disabled="true"]):active {
  background-color: var(--colors-surface3) !important;
}

[data-workspace-tab-close="true"]:not([aria-disabled="true"]):hover svg,
[data-workspace-tab-close="true"]:not([aria-disabled="true"]):active svg {
  color: var(--colors-foreground) !important;
}

[data-workspace-tab-action="true"]:not([aria-disabled="true"]):hover,
[data-workspace-tab-action="true"]:not([aria-disabled="true"]):active {
  background-color: var(--colors-surface2) !important;
}
`;

export function installWorkspaceDesktopTabsWebStyles(): () => void {
  return installWebInteractionStyles(WORKSPACE_DESKTOP_TABS_STYLE_ID, WORKSPACE_DESKTOP_TABS_CSS);
}
