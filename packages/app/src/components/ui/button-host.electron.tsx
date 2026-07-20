import {
  default as React,
  forwardRef,
  useCallback,
  useMemo,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export interface ButtonHostProps extends Omit<PressableProps, "children" | "style"> {
  children?: ReactNode;
  style?: PressableProps["style"];
}

function needsPressableFallback(props: ButtonHostProps): boolean {
  return Boolean(
    props.delayLongPress ||
    props.hitSlop ||
    props.onHoverIn ||
    props.onHoverOut ||
    props.onLongPress ||
    props.onPressIn ||
    props.onPressOut ||
    typeof props.style === "function" ||
    props.unstable_pressDelay,
  );
}

/**
 * Desktop buttons without gesture-phase callbacks use a semantic View host.
 * RN Web Pressable owns hovered/pressed React state even for static styles;
 * this host leaves visual pseudo-state to CSS without changing press behavior.
 */
export const ButtonHost = forwardRef<View, ButtonHostProps>(function ButtonHost(props, ref) {
  if (needsPressableFallback(props)) {
    const { children, style, ...pressableProps } = props;
    return (
      <Pressable ref={ref} style={style} {...pressableProps}>
        {children}
      </Pressable>
    );
  }

  return <StaticButtonHost hostRef={ref} props={props} />;
});

function StaticButtonHost({
  hostRef,
  props,
}: {
  hostRef: ForwardedRef<View>;
  props: ButtonHostProps;
}) {
  const {
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    focusable,
    onPress,
    style,
    tabIndex,
    ...viewProps
  } = props;
  const isDisabled = Boolean(disabled || accessibilityState?.disabled);
  const resolvedAccessibilityState = useMemo(
    () => ({ ...accessibilityState, disabled: isDisabled }),
    [accessibilityState, isDisabled],
  );

  const handleClick = useCallback(
    (event: GestureResponderEvent) => {
      if (!isDisabled) onPress?.(event);
    },
    [isDisabled, onPress],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || isDisabled) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onPress?.(event as never);
      } else if (event.key === " ") {
        event.preventDefault();
      }
    },
    [isDisabled, onPress],
  );
  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || isDisabled || event.key !== " ") return;
      event.preventDefault();
      onPress?.(event as never);
    },
    [isDisabled, onPress],
  );
  const webEventProps = useMemo(
    () =>
      ({
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        onKeyUp: handleKeyUp,
      }) as object,
    [handleClick, handleKeyDown, handleKeyUp],
  );

  return (
    <View
      {...viewProps}
      {...webEventProps}
      ref={hostRef}
      aria-disabled={isDisabled}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={resolvedAccessibilityState}
      focusable={focusable ?? !isDisabled}
      style={style as StyleProp<ViewStyle>}
      tabIndex={isDisabled ? -1 : (tabIndex ?? 0)}
    >
      {children}
    </View>
  );
}
