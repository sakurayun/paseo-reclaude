import { describe, expect, it } from "vitest";
import { resolveWorkspaceTabWheelScroll } from "@/screens/workspace/workspace-tab-wheel-scroll";

describe("resolveWorkspaceTabWheelScroll", () => {
  it("turns vertical wheel movement into horizontal scroll when tabs overflow", () => {
    const result = resolveWorkspaceTabWheelScroll({
      scrollLeft: 40,
      scrollWidth: 500,
      clientWidth: 200,
      deltaX: 0,
      deltaY: 80,
    });

    expect(result).toEqual({
      nextScrollLeft: 120,
      shouldPreventDefault: true,
    });
  });

  it("does not claim wheel events when there is no horizontal overflow", () => {
    const result = resolveWorkspaceTabWheelScroll({
      scrollLeft: 0,
      scrollWidth: 200,
      clientWidth: 200,
      deltaX: 0,
      deltaY: 80,
    });

    expect(result).toEqual({
      nextScrollLeft: 0,
      shouldPreventDefault: false,
    });
  });

  it("keeps horizontal-dominant trackpad gestures native", () => {
    const result = resolveWorkspaceTabWheelScroll({
      scrollLeft: 40,
      scrollWidth: 500,
      clientWidth: 200,
      deltaX: 90,
      deltaY: 40,
    });

    expect(result).toEqual({
      nextScrollLeft: 40,
      shouldPreventDefault: false,
    });
  });

  it("lets the page receive wheel events at the scroll edges", () => {
    const result = resolveWorkspaceTabWheelScroll({
      scrollLeft: 300,
      scrollWidth: 500,
      clientWidth: 200,
      deltaX: 0,
      deltaY: 80,
    });

    expect(result).toEqual({
      nextScrollLeft: 300,
      shouldPreventDefault: false,
    });
  });
});
