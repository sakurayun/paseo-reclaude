// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles.web";

const STYLE_ID = "paseo-test-interaction-styles";

afterEach(() => {
  document.getElementById(STYLE_ID)?.remove();
});

describe("installWebInteractionStyles", () => {
  it("shares one stylesheet until the last mounted consumer cleans up", () => {
    const cleanupFirst = installWebInteractionStyles(STYLE_ID, "[data-test] { opacity: 1; }");
    const cleanupSecond = installWebInteractionStyles(STYLE_ID, "[data-test] { opacity: 1; }");

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    cleanupFirst();
    expect(document.getElementById(STYLE_ID)).not.toBeNull();

    cleanupFirst();
    cleanupSecond();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("adopts and refreshes a stylesheet left behind by a web module reload", () => {
    const staleStyle = document.createElement("style");
    staleStyle.id = STYLE_ID;
    staleStyle.textContent = "stale";
    document.head.append(staleStyle);

    const cleanup = installWebInteractionStyles(STYLE_ID, "fresh");

    expect(document.getElementById(STYLE_ID)?.textContent).toBe("fresh");
    cleanup();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("uses a constructable stylesheet without adding a DOM node when supported", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "adoptedStyleSheets");
    const originalCssStyleSheet = globalThis.CSSStyleSheet;
    let adoptedStyleSheets: CSSStyleSheet[] = [];
    class TestStyleSheet {
      replaceSync(_cssText: string) {}
    }
    Object.defineProperty(document, "adoptedStyleSheets", {
      configurable: true,
      get: () => adoptedStyleSheets,
      set: (value: CSSStyleSheet[]) => {
        adoptedStyleSheets = value;
      },
    });
    Object.assign(globalThis, { CSSStyleSheet: TestStyleSheet });

    try {
      const cleanup = installWebInteractionStyles(STYLE_ID, "[data-test] { opacity: 1; }");
      expect(document.getElementById(STYLE_ID)).toBeNull();
      expect(adoptedStyleSheets).toHaveLength(1);

      cleanup();
      expect(adoptedStyleSheets).toHaveLength(0);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "adoptedStyleSheets", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "adoptedStyleSheets");
      }
      Object.assign(globalThis, { CSSStyleSheet: originalCssStyleSheet });
    }
  });
});
