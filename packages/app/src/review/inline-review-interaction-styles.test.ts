// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installInlineReviewInteractionStyles } from "./inline-review-interaction-styles";

const STYLE_ID = "paseo-inline-review-interaction-styles";

describe("inline review web interaction styles", () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it("uses CSS pseudo-classes and a pseudo-element for gutter feedback", () => {
    const cleanup = installInlineReviewInteractionStyles();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";

    expect(css).toContain("[data-paseo-diff-review-line]:hover");
    expect(css).toContain('[data-paseo-can-comment="true"]:active');
    expect(css).toContain("[data-paseo-inline-review-gutter-label]::after");
    expect(css).toContain('[data-paseo-editor-open="true"]');

    cleanup();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});
