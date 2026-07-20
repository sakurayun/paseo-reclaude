import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

export const USER_MESSAGE_CONTENT_DATA_SET = {
  paseoUserMessageContent: "true",
} as const;

export const USER_MESSAGE_TRAILING_ROW_DATA_SET = {
  paseoUserMessageTrailingRow: "true",
} as const;

export const MESSAGE_INTERACTION_STYLE_ID = "paseo-message-interaction-styles";

export const MESSAGE_INTERACTION_CSS = `
@media (hover: hover) and (pointer: fine) {
  [data-paseo-user-message-content="true"]
    [data-paseo-user-message-trailing-row="true"] {
    opacity: 0 !important;
    pointer-events: none !important;
    transition: opacity 80ms ease-out;
  }

  [data-paseo-user-message-content="true"]:hover
    [data-paseo-user-message-trailing-row="true"],
  [data-paseo-user-message-content="true"]:focus-within
    [data-paseo-user-message-trailing-row="true"] {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
}
`;

export function installMessageInteractionStyles(): () => void {
  return installWebInteractionStyles(MESSAGE_INTERACTION_STYLE_ID, MESSAGE_INTERACTION_CSS);
}
