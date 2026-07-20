import { installWebInteractionStyles } from "@/styles/install-web-interaction-styles";

export const DIFF_REVIEW_LINE_DATASET = {
  paseoDiffReviewLine: "true",
} as const;

export const INLINE_REVIEW_GUTTER_LABEL_DATASET = {
  paseoInlineReviewGutterLabel: "true",
} as const;

const STYLE_ID = "paseo-inline-review-interaction-styles";

const CSS_TEXT = `
[data-paseo-inline-review-gutter-label]::after {
  content: "";
  position: absolute;
  right: -10px;
  top: 50%;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background-color: var(--colors-accent);
  background-image:
    linear-gradient(var(--colors-accent-foreground), var(--colors-accent-foreground)),
    linear-gradient(var(--colors-accent-foreground), var(--colors-accent-foreground));
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
  background-size: 10px 2px, 2px 10px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  z-index: 10;
}

[data-paseo-diff-review-line]:hover
  [data-paseo-inline-review-gutter][data-paseo-can-comment="true"]
  [data-paseo-inline-review-gutter-label]::after,
[data-paseo-inline-review-gutter][data-paseo-can-comment="true"]:hover
  [data-paseo-inline-review-gutter-label]::after,
[data-paseo-inline-review-gutter][data-paseo-can-comment="true"]:active
  [data-paseo-inline-review-gutter-label]::after,
[data-paseo-inline-review-gutter][data-paseo-can-comment="true"][data-paseo-line-hovered="true"]
  [data-paseo-inline-review-gutter-label]::after {
  opacity: 1;
}

[data-paseo-inline-review-gutter][data-paseo-editor-open="true"]
  [data-paseo-inline-review-gutter-label]::after {
  opacity: 0;
}
`;

export function installInlineReviewInteractionStyles(): () => void {
  return installWebInteractionStyles(STYLE_ID, CSS_TEXT);
}
