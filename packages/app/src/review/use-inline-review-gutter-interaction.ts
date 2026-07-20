import { useCallback, useState } from "react";

export interface InlineReviewGutterInteraction {
  isActive: boolean;
  pressableProps: {
    onPressIn: () => void;
    onPressOut: () => void;
  };
}

/** Native press feedback; web visual feedback is handled by CSS pseudo-classes. */
export function useInlineReviewGutterInteraction(): InlineReviewGutterInteraction {
  const [isPressed, setIsPressed] = useState(false);
  const onPressIn = useCallback(() => setIsPressed(true), []);
  const onPressOut = useCallback(() => setIsPressed(false), []);

  return {
    isActive: isPressed,
    pressableProps: { onPressIn, onPressOut },
  };
}
