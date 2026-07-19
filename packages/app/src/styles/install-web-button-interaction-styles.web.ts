import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

const STYLE_ID = "paseo-web-button-interaction-styles";

const CSS_TEXT = `
[data-paseo-button="true"] {
  transition: opacity 80ms ease;
}

[data-paseo-button="true"]:not([aria-disabled="true"]):active {
  opacity: 0.85 !important;
}

[data-paseo-button-variant="ghost"] [data-paseo-button-label="true"],
[data-paseo-button-variant="ghost"] [data-paseo-button-icon="true"] svg {
  transition: color 80ms ease;
}

[data-paseo-button-variant="ghost"]:hover [data-paseo-button-label="true"],
[data-paseo-button-variant="ghost"]:hover [data-paseo-button-icon="true"] svg {
  color: var(--colors-foreground) !important;
}
`;

export function installWebButtonInteractionStyles(): () => void {
  return installWebInteractionStyles(STYLE_ID, CSS_TEXT);
}
