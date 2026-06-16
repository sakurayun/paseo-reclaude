import { useMemo, type ReactNode } from "react";
import { View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { UITextView } from "react-native-uitextview";
import { resolvePlainMarkdownTextStyle } from "@/components/markdown-text-style";

interface MarkdownTextSpanProps {
  style?: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
  // Links route through this span too (see assistant-file-links/link.tsx). A
  // plain <Text> nested in the paragraph UITextView is dropped, so the link
  // must be a UITextView span to be visible. onPress is wired onto the leaf
  // string children here: react-native-uitextview attaches it to the
  // RNUITextViewChild nodes it builds from string content, which the native tap
  // recognizer dispatches to. The link's handler reaches these leaf spans via
  // AssistantLinkPressProvider (see assistant-file-links/link-press-context).
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
}

// Inline span backed by UITextView so iOS gets native word-selection handles.
// Used inside MarkdownParagraphView (which is also a UITextView on iOS); the
// library's TextAncestorContext hoists these into UITextViewChild nodes so
// selection drags can cross sibling spans (e.g. plain text → **bold** → code).
export function MarkdownTextSpan({
  style,
  children,
  onPress,
  accessibilityRole,
}: MarkdownTextSpanProps) {
  const plainStyle = useMemo(() => resolvePlainMarkdownTextStyle(style), [style]);

  return (
    <UITextView
      uiTextView
      selectable
      style={plainStyle}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
    >
      {children}
    </UITextView>
  );
}

interface MarkdownParagraphViewProps {
  paragraphStyle: TextStyle & ViewStyle;
  paragraphTextStyle?: StyleProp<TextStyle>;
  containsImage?: boolean;
  children: ReactNode;
}

const MARKDOWN_PARAGRAPH_RESET: ViewStyle = {};

// UITextView re-wraps its text inside the frame Yoga assigns, while the
// paragraph's height was measured by RN's TextLayoutManager at the (possibly
// fractionally wider) pre-rounding content width. When a line ends flush with
// that measured width, the rounded-down frame pushes its last character onto
// an extra line that falls outside the measured height and is clipped by the
// host view (clipsToBounds). Reserving right padding keeps the measure width
// <= the native render width, so the re-wrap can never produce more lines than
// were measured. The bottom slack prevents the final glyph row from losing
// descenders when TextKit rounds the measured height down.
const MARKDOWN_PARAGRAPH_RENDER_SLACK: ViewStyle = { paddingRight: 2, paddingBottom: 1 };

// iOS-only: paragraph wraps in UITextView so the entire paragraph is one
// native text view. That's what unlocks cross-inline drag selection — handles
// can span every MarkdownTextSpan child inside this paragraph.
// ViewStyle is structurally compatible with the layout props paragraphs use
// (margin, padding, alignment); the cast lets the existing paragraphStyle
// flow through unchanged.
export function MarkdownParagraphView({
  paragraphStyle,
  paragraphTextStyle,
  containsImage = false,
  children,
}: MarkdownParagraphViewProps) {
  const textStyle = useMemo(
    () =>
      resolvePlainMarkdownTextStyle([
        paragraphTextStyle,
        paragraphStyle,
        MARKDOWN_PARAGRAPH_RESET,
        MARKDOWN_PARAGRAPH_RENDER_SLACK,
      ] as StyleProp<TextStyle>),
    [paragraphStyle, paragraphTextStyle],
  );
  const viewStyle = useMemo(() => [paragraphStyle, MARKDOWN_PARAGRAPH_RESET], [paragraphStyle]);

  if (containsImage) {
    return <View style={viewStyle}>{children}</View>;
  }

  return (
    <UITextView uiTextView selectable style={textStyle}>
      {children}
    </UITextView>
  );
}
