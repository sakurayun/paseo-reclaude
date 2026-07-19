export const DIFF_REVIEW_LINE_DATASET = {
  paseoDiffReviewLine: "true",
} as const;

export const INLINE_REVIEW_GUTTER_LABEL_DATASET = {
  paseoInlineReviewGutterLabel: "true",
} as const;

export function installInlineReviewInteractionStyles(): () => void {
  return () => {};
}
