import { useMemo, type ReactNode } from "react";
import {
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

interface MarkdownTextSpanProps {
  style?: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
}

// Android's <Text selectable> enables per-text-node selection natively. Each
// sibling Text is its own selection scope — drag can't span across siblings
// (that requires a single UITextView ancestor and is iOS-only). onPress works
// natively here, so links routed through this span stay tappable on Android.
export function MarkdownTextSpan({
  style,
  children,
  onPress,
  accessibilityRole,
}: MarkdownTextSpanProps) {
  return (
    <Text selectable style={style} onPress={onPress} accessibilityRole={accessibilityRole}>
      {children}
    </Text>
  );
}

interface MarkdownParagraphViewProps {
  paragraphStyle: TextStyle & ViewStyle;
  paragraphTextStyle?: StyleProp<TextStyle>;
  containsImage?: boolean;
  children: ReactNode;
}

const MARKDOWN_PARAGRAPH_RESET: ViewStyle = {};
const MARKDOWN_TEXT_PARAGRAPH_RESET: TextStyle = {};
const MARKDOWN_TEXT_PARAGRAPH_RENDER_SLACK: TextStyle = { paddingRight: 2, paddingBottom: 1 };

// Text-only paragraphs must be one native Text layout on Android. Rendering
// inline marks as sibling Text nodes inside a wrapping View lets the last glyph
// wrap independently from the paragraph measurement, which can leave it clipped.
export function MarkdownParagraphView({
  paragraphStyle,
  paragraphTextStyle,
  containsImage = false,
  children,
}: MarkdownParagraphViewProps) {
  const viewStyle = useMemo(() => [paragraphStyle, MARKDOWN_PARAGRAPH_RESET], [paragraphStyle]);
  const textStyle = useMemo(
    () => [
      paragraphTextStyle,
      paragraphStyle,
      MARKDOWN_TEXT_PARAGRAPH_RESET,
      MARKDOWN_TEXT_PARAGRAPH_RENDER_SLACK,
    ],
    [paragraphStyle, paragraphTextStyle],
  );

  if (containsImage) {
    return <View style={viewStyle}>{children}</View>;
  }

  return (
    <Text selectable style={textStyle}>
      {children}
    </Text>
  );
}
