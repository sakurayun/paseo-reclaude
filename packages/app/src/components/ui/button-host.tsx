import React, { forwardRef, type ReactNode } from "react";
import { Pressable, type PressableProps, type View } from "react-native";

export interface ButtonPressEvent {
  stopPropagation(): void;
}

export interface ButtonHostProps extends Omit<PressableProps, "children" | "onPress" | "style"> {
  children?: ReactNode;
  onPress?: (event: ButtonPressEvent) => void;
  style?: PressableProps["style"];
}

export const ButtonHost = forwardRef<View, ButtonHostProps>(function ButtonHost(
  { children, style, ...props },
  ref,
) {
  return (
    <Pressable ref={ref} style={style} {...props}>
      {children}
    </Pressable>
  );
});
