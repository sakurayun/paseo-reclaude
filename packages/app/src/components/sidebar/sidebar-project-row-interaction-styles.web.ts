import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

export const SIDEBAR_PROJECT_ROW_STYLE_ID = "paseo-sidebar-project-row-interactions";

export const SIDEBAR_PROJECT_ROW_CSS = `
@media (hover: hover) and (pointer: fine) {
  [data-sidebar-project-row]:not([data-sidebar-project-dragging="true"]):hover {
    background-color: var(--colors-surface-sidebar-hover) !important;
  }

  [data-sidebar-project-row]:not([data-sidebar-project-dragging="true"]):active {
    background-color: var(--colors-surface2) !important;
  }

  [data-sidebar-project-hover-action] {
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden;
  }

  [data-sidebar-project-leading-visual][data-sidebar-project-chevron]::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--colors-foreground-muted);
    border-bottom: 1.5px solid var(--colors-foreground-muted);
    opacity: 0;
    visibility: hidden;
  }

  [data-sidebar-project-leading-visual][data-sidebar-project-chevron="expand"]::after {
    transform: translate(-65%, -50%) rotate(-45deg);
  }

  [data-sidebar-project-leading-visual][data-sidebar-project-chevron="collapse"]::after {
    transform: translate(-50%, -65%) rotate(45deg);
  }

  [data-sidebar-project-row]:hover
    [data-sidebar-project-leading-visual][data-sidebar-project-chevron]
    > * {
    opacity: 0 !important;
  }

  [data-sidebar-project-row]:hover
    [data-sidebar-project-leading-visual][data-sidebar-project-chevron]::after,
  [data-sidebar-project-row]:hover [data-sidebar-project-hover-action] {
    opacity: 1 !important;
    pointer-events: auto !important;
    visibility: visible;
  }
}
`;

export function installSidebarProjectRowInteractionStyles(): () => void {
  return installWebInteractionStyles(SIDEBAR_PROJECT_ROW_STYLE_ID, SIDEBAR_PROJECT_ROW_CSS);
}
