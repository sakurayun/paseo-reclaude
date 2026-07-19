interface InlineReviewGutterInteraction {
  isActive: boolean;
  pressableProps: Record<string, never>;
}

const WEB_INTERACTION: InlineReviewGutterInteraction = {
  isActive: false,
  pressableProps: {},
};

/** Web hover/active feedback stays in CSS and never schedules a React update. */
export function useInlineReviewGutterInteraction(): InlineReviewGutterInteraction {
  return WEB_INTERACTION;
}
