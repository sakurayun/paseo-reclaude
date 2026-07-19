// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installMessageInteractionStyles,
  MESSAGE_INTERACTION_CSS,
  MESSAGE_INTERACTION_STYLE_ID,
  USER_MESSAGE_CONTENT_DATA_SET,
  USER_MESSAGE_TRAILING_ROW_DATA_SET,
} from "./message-interaction-styles.web";

afterEach(() => {
  document.getElementById(MESSAGE_INTERACTION_STYLE_ID)?.remove();
});

describe("message interaction styles", () => {
  it("uses stable data attributes to reveal message actions without React hover state", () => {
    expect(USER_MESSAGE_CONTENT_DATA_SET).toEqual({ paseoUserMessageContent: "true" });
    expect(USER_MESSAGE_TRAILING_ROW_DATA_SET).toEqual({
      paseoUserMessageTrailingRow: "true",
    });
    expect(MESSAGE_INTERACTION_CSS).toContain('[data-paseo-user-message-content="true"]:hover');
    expect(MESSAGE_INTERACTION_CSS).toContain(
      '[data-paseo-user-message-content="true"]:focus-within',
    );
    expect(MESSAGE_INTERACTION_CSS).toContain("pointer-events: none !important");
  });

  it("installs the component-owned stylesheet through the shared registry", () => {
    const cleanup = installMessageInteractionStyles();

    const style = document.getElementById(MESSAGE_INTERACTION_STYLE_ID);
    expect(style?.textContent).toBe(MESSAGE_INTERACTION_CSS);

    cleanup();
    expect(document.getElementById(MESSAGE_INTERACTION_STYLE_ID)).toBeNull();
  });

  it("keeps UserMessage visual hover out of React state and event props", () => {
    const appRoot = process.cwd().endsWith("packages/app")
      ? process.cwd()
      : path.resolve(process.cwd(), "packages/app");
    const source = readFileSync(path.resolve(appRoot, "src/components/message.tsx"), "utf8");
    const userMessageSource = source.slice(
      source.indexOf("export const UserMessage = memo"),
      source.indexOf("interface AssistantTurnFooterProps"),
    );

    expect(userMessageSource).toContain("USER_MESSAGE_CONTENT_DATA_SET");
    expect(userMessageSource).toContain("USER_MESSAGE_TRAILING_ROW_DATA_SET");
    expect(userMessageSource).not.toContain("setIsHovered");
    expect(userMessageSource).not.toContain("onPointerEnter");
    expect(userMessageSource).not.toContain("onPointerLeave");
  });
});
