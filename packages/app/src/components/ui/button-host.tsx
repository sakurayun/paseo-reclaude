import React, { forwardRef, type ReactNode } from "react";
import { Pressable, type PressableProps, type View } from "react-native";

export interface ButtonHostProps extends Omit<PressableProps, "children" | "style"> {
  children?: ReactNode;
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
