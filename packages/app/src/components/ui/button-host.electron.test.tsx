// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ButtonHost } from "@/components/ui/button-host.electron";

afterEach(cleanup);

describe("ButtonHost Electron fast path", () => {
  it("handles pointer and keyboard activation without rendering on hover", () => {
    const onPress = vi.fn();
    const renderChild = vi.fn(() => <span>Run</span>);
    const Child = () => renderChild();
    render(
      <ButtonHost accessibilityLabel="Run action" onPress={onPress}>
        <Child />
      </ButtonHost>,
    );
    const button = screen.getByRole("button", { name: "Run action" });

    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    expect(renderChild).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it("keeps disabled buttons out of the tab order and blocks activation", () => {
    const onPress = vi.fn();
    render(
      <ButtonHost accessibilityLabel="Disabled action" disabled onPress={onPress}>
        <span>Disabled</span>
      </ButtonHost>,
    );
    const button = screen.getByRole("button", { name: "Disabled action" });

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onPress).not.toHaveBeenCalled();
  });
});
