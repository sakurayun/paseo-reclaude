import { Stack } from "expo-router";
import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { withUnistyles } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";

type NativeStackNavigationOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

type StackScreenLayout = ComponentProps<typeof Stack>["screenLayout"];

interface ThemedStackBaseProps {
  backgroundColor: string;
  children?: ReactNode;
  screenOptions?: NativeStackNavigationOptions;
  screenLayout?: StackScreenLayout;
  // Screens whose content is another navigator. That navigator owns its own screens' appearance
  // boundary; wrapping it here would remount it.
  nestedNavigatorScreens?: readonly string[];
  /** Screens with retained lifetime owners update appearance at their own leaves. */
  screenOwnedAppearance?: readonly string[];
}

function ThemedStackBase({
  backgroundColor,
  children,
  screenOptions,
  screenLayout: outerScreenLayout,
  nestedNavigatorScreens,
  screenOwnedAppearance,
}: ThemedStackBaseProps) {
  const themedScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      ...screenOptions,
      contentStyle: [{ backgroundColor }, screenOptions?.contentStyle],
    }),
    [backgroundColor, screenOptions],
  );
  // Appearance changes remount each screen's content below the native stack, so the navigator
  // and its screen containers keep their identity. See docs/unistyles.md.
  const screenLayout = useCallback<NonNullable<StackScreenLayout>>(
    (props): ReactElement => {
      const { route, children: screenChildren } = props;
      const content = outerScreenLayout ? outerScreenLayout(props) : screenChildren;
      if (
        (nestedNavigatorScreens?.includes(route.name) ||
          screenOwnedAppearance?.includes(route.name)) &&
        isValidElement(content)
      )
        return content;
      return <AppearanceStyleBoundary>{content}</AppearanceStyleBoundary>;
    },
    [nestedNavigatorScreens, screenOwnedAppearance, outerScreenLayout],
  );

  return (
    <Stack screenOptions={themedScreenOptions} screenLayout={screenLayout}>
      {children}
    </Stack>
  );
}

export const ThemedStack = withUnistyles(ThemedStackBase, (theme) => ({
  backgroundColor: theme.colors.surface0,
}));
