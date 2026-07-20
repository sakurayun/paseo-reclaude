interface InstalledStyle {
  references: number;
  remove: () => void;
}

const installedStyles = new Map<string, InstalledStyle>();

/**
 * Installs a component-owned web stylesheet once and reference-counts mounts.
 *
 * Interaction fast paths use stable data attributes plus CSS pseudo-classes so
 * visual hover/active feedback does not schedule React work. Components still
 * own semantic interaction state such as selection, menus, and drag gestures.
 */
export function installWebInteractionStyles(styleId: string, cssText: string): () => void {
  let installed = installedStyles.get(styleId);
  if (!installed) {
    if (
      "adoptedStyleSheets" in document &&
      typeof CSSStyleSheet !== "undefined" &&
      typeof CSSStyleSheet.prototype.replaceSync === "function"
    ) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      installed = {
        references: 0,
        remove: () => {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
            (candidate) => candidate !== sheet,
          );
        },
      };
    } else {
      const existing = document.getElementById(styleId);
      const element =
        existing instanceof HTMLStyleElement ? existing : document.createElement("style");
      element.id = styleId;
      element.textContent = cssText;
      if (!element.isConnected) {
        document.head.append(element);
      }
      installed = { references: 0, remove: () => element.remove() };
    }
    installedStyles.set(styleId, installed);
  }

  installed.references += 1;
  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    const current = installedStyles.get(styleId);
    if (!current) return;
    current.references -= 1;
    if (current.references === 0) {
      current.remove();
      installedStyles.delete(styleId);
    }
  };
}
