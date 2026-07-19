import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

const STYLE_ID = "paseo-composer-input-interaction-styles";

const CSS_TEXT = `
@media (hover: hover) and (pointer: fine) {
  [data-composer-input-action]:not([data-composer-input-disabled="true"]):not([data-composer-input-recording="true"]):hover {
    background-color: var(--colors-surface2) !important;
  }

  [data-composer-input-action]:not([data-composer-input-disabled="true"]):not([data-composer-input-recording="true"]):hover [data-composer-input-icon],
  [data-composer-input-action]:not([data-composer-input-disabled="true"]):not([data-composer-input-recording="true"]):hover [data-composer-input-icon] svg {
    color: var(--colors-foreground) !important;
    stroke: var(--colors-foreground) !important;
  }
}
`;

export function installComposerInputInteractionStyles(): () => void {
  return installWebInteractionStyles(STYLE_ID, CSS_TEXT);
}
