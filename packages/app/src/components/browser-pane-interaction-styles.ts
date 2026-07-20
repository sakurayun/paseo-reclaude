export const BROWSER_TOOLBAR_BUTTON_DATA_SET = {
  paseoBrowserToolbarButton: "true",
} as const;

/** Native fallback; Electron builds resolve browser-pane-interaction-styles.web.ts. */
export function installBrowserPaneInteractionStyles(): () => void {
  return () => {};
}
