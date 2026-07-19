// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installComposerInputInteractionStyles } from "./install-interaction-styles.web";

const STYLE_ID = "paseo-composer-input-interaction-styles";

afterEach(() => {
  document.getElementById(STYLE_ID)?.remove();
});

describe("installComposerInputInteractionStyles", () => {
  it("installs a CSS hover fast path that excludes disabled and recording controls", () => {
    const cleanup = installComposerInputInteractionStyles();
    const cssText = document.getElementById(STYLE_ID)?.textContent ?? "";

    expect(cssText).toContain("[data-composer-input-action]");
    expect(cssText).toContain(':not([data-composer-input-disabled="true"])');
    expect(cssText).toContain(':not([data-composer-input-recording="true"])');
    expect(cssText).toContain(":hover");
    expect(cssText).toContain("var(--colors-surface2)");
    expect(cssText).toContain("var(--colors-foreground)");

    cleanup();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});
