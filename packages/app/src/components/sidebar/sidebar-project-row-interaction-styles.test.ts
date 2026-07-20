// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  installSidebarProjectRowInteractionStyles,
  SIDEBAR_PROJECT_ROW_STYLE_ID,
} from "@/components/sidebar/sidebar-project-row-interaction-styles.web";

afterEach(() => {
  document.getElementById(SIDEBAR_PROJECT_ROW_STYLE_ID)?.remove();
});

describe("sidebar project row interaction styles", () => {
  it("uses CSS pseudo states for row feedback and descendant disclosure", () => {
    const cleanup = installSidebarProjectRowInteractionStyles();
    const css = document.getElementById(SIDEBAR_PROJECT_ROW_STYLE_ID)?.textContent ?? "";

    expect(css).toContain("[data-sidebar-project-row]");
    expect(css).toContain(":hover");
    expect(css).toContain(":active");
    expect(css).toContain('[data-sidebar-project-chevron="expand"]::after');
    expect(css).toContain('[data-sidebar-project-chevron="collapse"]::after');
    expect(css).toContain("[data-sidebar-project-hover-action]");
    expect(css).toContain("visibility: hidden");
    expect(css).toContain("pointer-events: auto !important");
    expect(css).toContain("var(--colors-surface-sidebar-hover)");
    expect(css).toContain("var(--colors-foreground-muted)");
    expect(css).not.toMatch(/var\(--colors-[^)]*[A-Z]/);

    cleanup();
    expect(document.getElementById(SIDEBAR_PROJECT_ROW_STYLE_ID)).toBeNull();
  });
});
