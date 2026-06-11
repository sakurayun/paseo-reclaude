import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { FileReadResult } from "@getpaseo/client/internal/daemon-client";
import Markdown, {
  type ASTNode,
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import {
  ActivityIndicator,
  Image as RNImage,
  ScrollView as RNScrollView,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownParagraphView, MarkdownTextSpan } from "@/components/markdown-text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { openExternalUrl } from "@/utils/open-external-url";
import type { HighlightToken } from "@getpaseo/highlight";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import { isWeb } from "@/constants/platform";
import { createMarkdownStyles } from "@/styles/markdown-styles";
import { getMarkdownListMarker, getMarkdownListSpacing } from "@/utils/markdown-list";
import { markdownNodeContainsType } from "@/utils/markdown-ast";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import {
  createFilePaneFindTokenSegments,
  createFilePaneLineFindHighlightMap,
  createFilePaneTextRenderData,
  findFilePaneTextMatches,
  type FilePaneFindLineHighlight,
  type FilePaneFindMatch,
  type FilePaneFindTokenSegment,
} from "@/components/file-pane-text-render-data";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import {
  FindBar,
  type PaneFindMatchState,
  type UsePaneFindResult,
  usePaneFind,
} from "@/panels/pane-find";

interface CodeLineProps {
  segments: FilePaneFindTokenSegment[];
  lineNumber: number;
  gutterWidth: number;
  highlighted: boolean;
  matchBackgroundColor: string;
  currentMatchBackgroundColor: string;
  onLineRef?: (lineNumber: number, node: View | null) => void;
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  isLoading: boolean;
  showDesktopWebScrollbar: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  imagePreviewUri: string | null;
}

type MarkdownStyles = Record<string, TextStyle & ViewStyle & { [key: string]: unknown }>;

interface FilePaneTextScrollRefs {
  lineRefs: React.MutableRefObject<Map<number, View>>;
  previewScrollRef: React.RefObject<RNScrollView | null>;
  registerLineRef: (lineNumber: number, node: View | null) => void;
}

interface FilePaneCenterStateProps {
  children: React.ReactNode;
}

interface FilePaneTextPreviewProps {
  currentMatchBackgroundColor: string;
  findHighlightsByLine: Map<number, FilePaneFindLineHighlight[]>;
  gutterWidth: number;
  isMarkdownFile: boolean;
  isMobile: boolean;
  lineSelection: FileLineSelection | null;
  markdownParser: ReturnType<typeof MarkdownIt>;
  markdownRules: RenderRules;
  markdownStyles: ReturnType<typeof createMarkdownStyles>;
  matchBackgroundColor: string;
  preview: ExplorerFile;
  previewScrollRef: React.RefObject<RNScrollView | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showDesktopWebScrollbar: boolean;
  textRenderData: ReturnType<typeof createFilePaneTextRenderData> | null;
  textScrollRefs: FilePaneTextScrollRefs;
  webScrollbarStyle: object;
}

interface FilePaneSearchableTextPreviewProps extends Omit<
  FilePaneTextPreviewProps,
  "findHighlightsByLine" | "textRenderData"
> {
  textRenderData: ReturnType<typeof createFilePaneTextRenderData>;
}

interface FilePaneImagePreviewProps {
  imagePreviewUri: string | null;
  imageSource: { uri: string } | null;
  previewScrollRef: React.RefObject<RNScrollView | null>;
  scrollbar: ReturnType<typeof useWebScrollViewScrollbar>;
  showDesktopWebScrollbar: boolean;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
}> {
  if (!file) {
    return { file: null, imageAttachment: null };
  }

  const explorerFile = explorerFileFromReadResult(file);
  if (file.kind !== "image") {
    return { file: explorerFile, imageAttachment: null };
  }

  const imageAttachment = await persistAttachmentFromBytes({
    id: createPreviewAttachmentId({
      mimeType: file.mime,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
    }),
    bytes: file.bytes,
    mimeType: file.mime,
    fileName: getFileNameFromPath(file.path),
  });

  return {
    file: explorerFile,
    imageAttachment,
  };
}

function clampLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) {
    return null;
  }
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

interface MarkdownInheritedTextProps {
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  style?: TextStyle;
  monoSurface?: boolean;
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
  children: ReactNode;
}

function MarkdownInheritedText({
  inheritedStyles,
  textStyle,
  style: overrideStyle,
  monoSurface,
  onPress,
  accessibilityRole,
  children,
}: MarkdownInheritedTextProps) {
  const style = useMemo(
    () => [inheritedStyles, textStyle, overrideStyle],
    [inheritedStyles, textStyle, overrideStyle],
  );
  return (
    <MarkdownTextSpan
      monoSurface={monoSurface}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      style={style}
    >
      {children}
    </MarkdownTextSpan>
  );
}

interface MarkdownListItemContentProps {
  contentStyle: ViewStyle;
  children: ReactNode;
}

const MARKDOWN_LIST_ITEM_CONTENT_FLEX: ViewStyle = { flex: 1, flexShrink: 1, minWidth: 0 };
const EMPTY_TEXT_STYLE: TextStyle = {};

function MarkdownListItemContent({ contentStyle, children }: MarkdownListItemContentProps) {
  const style = useMemo(() => [contentStyle, MARKDOWN_LIST_ITEM_CONTENT_FLEX], [contentStyle]);
  return <View style={style}>{children}</View>;
}

interface MarkdownListViewProps {
  baseStyle: ViewStyle;
  spacing: { marginTop: number; marginBottom: number };
  children: ReactNode;
}

function MarkdownListView({ baseStyle, spacing, children }: MarkdownListViewProps) {
  const style = useMemo(() => [baseStyle, spacing], [baseStyle, spacing]);
  return <View style={style}>{children}</View>;
}

interface FilePreviewMarkdownLinkProps {
  href: string;
  inheritedStyles: TextStyle;
  linkStyle: TextStyle;
  onLinkPress?: (url: string) => boolean;
  children: ReactNode;
}

function FilePreviewMarkdownLink({
  href,
  inheritedStyles,
  linkStyle,
  onLinkPress,
  children,
}: FilePreviewMarkdownLinkProps) {
  const handlePress = useCallback(() => {
    if (!href) return;
    if (onLinkPress?.(href) === false) return;
    void openExternalUrl(href);
  }, [href, onLinkPress]);

  return (
    <MarkdownInheritedText
      inheritedStyles={inheritedStyles}
      textStyle={linkStyle}
      accessibilityRole="link"
      onPress={handlePress}
    >
      {children}
    </MarkdownInheritedText>
  );
}

function getMarkdownLinkHref(node: ASTNode): string {
  const href = node.attributes?.href;
  return typeof href === "string" ? href : "";
}

function createFilePreviewMarkdownRules(): RenderRules {
  return {
    text: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.text}
      >
        {node.content}
      </MarkdownInheritedText>
    ),
    textgroup: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.textgroup}
      >
        {children}
      </MarkdownInheritedText>
    ),
    strong: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.strong}
      >
        {children}
      </MarkdownInheritedText>
    ),
    em: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText key={node.key} inheritedStyles={inheritedStyles} textStyle={styles.em}>
        {children}
      </MarkdownInheritedText>
    ),
    s: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText key={node.key} inheritedStyles={inheritedStyles} textStyle={styles.s}>
        {children}
      </MarkdownInheritedText>
    ),
    hardbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
    softbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
    code_block: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <HighlightedCodeBlock
        key={node.key}
        code={node.content}
        language={null}
        inheritedStyles={inheritedStyles}
        textStyle={styles.code_block}
      />
    ),
    fence: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <HighlightedCodeBlock
        key={node.key}
        code={node.content}
        language={node.sourceInfo}
        inheritedStyles={inheritedStyles}
        textStyle={styles.fence}
      />
    ),
    code_inline: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownInheritedText
        key={node.key}
        inheritedStyles={inheritedStyles}
        textStyle={styles.code_inline}
        monoSurface
      >
        {node.content ?? ""}
      </MarkdownInheritedText>
    ),
    bullet_list: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownListView
        key={node.key}
        baseStyle={styles.bullet_list}
        spacing={getMarkdownListSpacing(node, parent)}
      >
        {children}
      </MarkdownListView>
    ),
    ordered_list: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownListView
        key={node.key}
        baseStyle={styles.ordered_list}
        spacing={getMarkdownListSpacing(node, parent)}
      >
        {children}
      </MarkdownListView>
    ),
    list_item: (
      node: ASTNode,
      children: ReactNode[],
      parent: ASTNode[],
      styles: MarkdownStyles,
    ) => {
      const { isOrdered, marker } = getMarkdownListMarker(node, parent);
      const iconStyle = isOrdered ? styles.ordered_list_icon : styles.bullet_list_icon;
      const contentStyle = isOrdered ? styles.ordered_list_content : styles.bullet_list_content;

      return (
        <View key={node.key} style={styles.list_item}>
          <Text style={iconStyle}>{marker}</Text>
          <MarkdownListItemContent contentStyle={contentStyle}>{children}</MarkdownListItemContent>
        </View>
      );
    },
    paragraph: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <MarkdownParagraphView
        key={node.key}
        paragraphStyle={styles.paragraph}
        containsImage={markdownNodeContainsType(node, "image")}
      >
        {children}
      </MarkdownParagraphView>
    ),
    link: (
      node: ASTNode,
      children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      onLinkPress?: (url: string) => boolean,
    ) => (
      <FilePreviewMarkdownLink
        key={node.key}
        href={getMarkdownLinkHref(node)}
        inheritedStyles={EMPTY_TEXT_STYLE}
        linkStyle={styles.link}
        onLinkPress={onLinkPress}
      >
        {children}
      </FilePreviewMarkdownLink>
    ),
  };
}

const CodeLine = React.memo(function CodeLine({
  segments,
  lineNumber,
  gutterWidth,
  highlighted,
  matchBackgroundColor,
  currentMatchBackgroundColor,
  onLineRef,
}: CodeLineProps) {
  const setLineRef = useCallback(
    (node: View | null) => {
      onLineRef?.(lineNumber, node);
    },
    [lineNumber, onLineRef],
  );
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
  const keyedTokens = useMemo(
    () => segments.map((segment, index) => ({ key: `${index}-${segment.text}`, segment })),
    [segments],
  );
  return (
    <View ref={setLineRef} style={lineStyle}>
      <View style={gutterStyle}>
        <Text numberOfLines={1} style={codeLineStyles.gutterText}>
          {String(lineNumber)}
        </Text>
      </View>
      <Text selectable style={codeLineStyles.lineText}>
        {keyedTokens.map(({ key, segment }) => (
          <CodeLineToken
            key={key}
            backgroundColor={getFindSegmentBackgroundColor({
              currentMatchBackgroundColor,
              matchBackgroundColor,
              segment,
            })}
            style={segment.style}
            text={segment.text}
          />
        ))}
      </Text>
    </View>
  );
});

interface CodeLineTokenProps {
  backgroundColor?: string;
  style: HighlightToken["style"];
  text: string;
}

function CodeLineToken({ backgroundColor, style, text }: CodeLineTokenProps) {
  const tokenStyle = useMemo(
    () => [
      style ? syntaxTokenStyleFor(style) : undefined,
      backgroundColor ? { backgroundColor } : null,
    ],
    [backgroundColor, style],
  );
  return <Text style={tokenStyle}>{text}</Text>;
}

function getFindSegmentBackgroundColor(input: {
  segment: FilePaneFindTokenSegment;
  matchBackgroundColor: string;
  currentMatchBackgroundColor: string;
}) {
  if (input.segment.isCurrentFindMatch) {
    return input.currentMatchBackgroundColor;
  }
  if (input.segment.isFindMatch) {
    return input.matchBackgroundColor;
  }
  return undefined;
}

function useFilePaneTextScrollRefs(lineNumbers: number[] | null): FilePaneTextScrollRefs {
  const previewScrollRef = useRef<RNScrollView>(null);
  const lineRefs = useRef(new Map<number, View>());

  const registerLineRef = useCallback((lineNumber: number, node: View | null) => {
    if (node) {
      lineRefs.current.set(lineNumber, node);
      return;
    }
    lineRefs.current.delete(lineNumber);
  }, []);

  useEffect(() => {
    if (!lineNumbers) {
      lineRefs.current.clear();
      return;
    }

    const visibleLineNumbers = new Set(lineNumbers);
    for (const lineNumber of lineRefs.current.keys()) {
      if (!visibleLineNumbers.has(lineNumber)) {
        lineRefs.current.delete(lineNumber);
      }
    }
  }, [lineNumbers]);

  return {
    lineRefs,
    previewScrollRef,
    registerLineRef,
  };
}

function createFilePaneMatchState(
  query: string,
  matches: FilePaneFindMatch[],
  currentMatchIndex: number,
): PaneFindMatchState {
  if (query.length === 0) {
    return { status: "empty" };
  }
  if (matches.length === 0) {
    return { status: "no-match" };
  }
  return {
    status: "matched",
    current: Math.max(0, currentMatchIndex) + 1,
    total: matches.length,
  };
}

function scrollFilePaneLineIntoView(input: {
  lineRefs: React.MutableRefObject<Map<number, View>>;
  previewScrollRef: React.RefObject<RNScrollView | null>;
  lineNumber: number;
}) {
  const lineNode = input.lineRefs.current.get(input.lineNumber);
  const scrollNode = input.previewScrollRef.current;
  if (!lineNode || !scrollNode) {
    return;
  }

  if (isWeb && "scrollIntoView" in lineNode) {
    (
      lineNode as unknown as { scrollIntoView(options?: ScrollIntoViewOptions): void }
    ).scrollIntoView({
      block: "center",
      inline: "nearest",
    });
    return;
  }

  const measurableLineNode = lineNode as View & {
    measureLayout?: (
      relativeToNativeNode: unknown,
      onSuccess: (x: number, y: number) => void,
      onFail?: () => void,
    ) => void;
  };
  measurableLineNode.measureLayout?.(scrollNode, (_x, y) => {
    scrollNode.scrollTo({ y: Math.max(0, y - 48), animated: true });
  });
}

function scrollFilePaneLineIntoViewSoon(input: {
  lineRefs: React.MutableRefObject<Map<number, View>>;
  previewScrollRef: React.RefObject<RNScrollView | null>;
  lineNumber: number;
}) {
  const schedule =
    globalThis.requestAnimationFrame ??
    ((callback: FrameRequestCallback) => {
      setTimeout(() => callback(Date.now()), 0);
      return 0;
    });
  schedule(() => {
    scrollFilePaneLineIntoView(input);
  });
}

interface FilePaneFindState {
  query: string;
  matches: FilePaneFindMatch[];
  currentMatchIndex: number;
}

const EMPTY_FILE_PANE_FIND_STATE: FilePaneFindState = {
  query: "",
  matches: [],
  currentMatchIndex: 0,
};

function useFilePaneFindAdapter(input: {
  textRenderData: ReturnType<typeof createFilePaneTextRenderData> | null;
  textScrollRefs: FilePaneTextScrollRefs;
}) {
  const [findState, setFindState] = useState<FilePaneFindState>(EMPTY_FILE_PANE_FIND_STATE);
  const findQuery = findState.query;
  const findMatches = findState.matches;
  const currentMatchIndex = findState.currentMatchIndex;
  const findHighlightsByLine = useMemo(
    () => createFilePaneLineFindHighlightMap(findMatches, currentMatchIndex),
    [currentMatchIndex, findMatches],
  );
  const findMatchState = useMemo(
    () => createFilePaneMatchState(findQuery, findMatches, currentMatchIndex),
    [currentMatchIndex, findMatches, findQuery],
  );
  const scrollMatchIntoView = useCallback(
    (matches: FilePaneFindMatch[], matchIndex: number) => {
      const lineNumber = matches[matchIndex]?.lineSpans[0]?.lineNumber;
      if (!lineNumber) {
        return;
      }
      scrollFilePaneLineIntoViewSoon({
        lineRefs: input.textScrollRefs.lineRefs,
        lineNumber,
        previewScrollRef: input.textScrollRefs.previewScrollRef,
      });
    },
    [input.textScrollRefs.lineRefs, input.textScrollRefs.previewScrollRef],
  );
  const paneFind = usePaneFind({
    matchState: findMatchState,
    onQuery: (query) => {
      const nextMatches = input.textRenderData
        ? findFilePaneTextMatches(input.textRenderData, query)
        : [];
      setFindState({ query, matches: nextMatches, currentMatchIndex: 0 });
      scrollMatchIntoView(nextMatches, 0);
      return createFilePaneMatchState(query, nextMatches, 0);
    },
    onNext: () => {
      if (findMatches.length === 0) {
        return createFilePaneMatchState(findQuery, findMatches, currentMatchIndex);
      }
      const nextIndex = (currentMatchIndex + 1) % findMatches.length;
      setFindState((current) => ({ ...current, currentMatchIndex: nextIndex }));
      scrollMatchIntoView(findMatches, nextIndex);
      return createFilePaneMatchState(findQuery, findMatches, nextIndex);
    },
    onPrev: () => {
      if (findMatches.length === 0) {
        return createFilePaneMatchState(findQuery, findMatches, currentMatchIndex);
      }
      const nextIndex = (currentMatchIndex - 1 + findMatches.length) % findMatches.length;
      setFindState((current) => ({ ...current, currentMatchIndex: nextIndex }));
      scrollMatchIntoView(findMatches, nextIndex);
      return createFilePaneMatchState(findQuery, findMatches, nextIndex);
    },
    onClose: () => {
      setFindState(EMPTY_FILE_PANE_FIND_STATE);
    },
  });

  useEffect(() => {
    setFindState((current) => {
      if (!input.textRenderData || current.query.length === 0) {
        return current.query.length === 0 &&
          current.matches.length === 0 &&
          current.currentMatchIndex === 0
          ? current
          : EMPTY_FILE_PANE_FIND_STATE;
      }

      const nextMatches = findFilePaneTextMatches(input.textRenderData, current.query);
      const nextMatchIndex =
        nextMatches.length === 0 ? 0 : Math.min(current.currentMatchIndex, nextMatches.length - 1);

      return {
        query: current.query,
        matches: nextMatches,
        currentMatchIndex: nextMatchIndex,
      };
    });
  }, [input.textRenderData]);

  return {
    findHighlightsByLine,
    paneFind,
  };
}

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: theme.spacing[3],
    flexShrink: 0,
  },
  gutterText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    opacity: 0.4,
    userSelect: "none",
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    flex: 1,
  },
}));

function FilePaneFindBarSlot({ paneFind }: { paneFind: UsePaneFindResult }) {
  return paneFind.isOpen ? <FindBar {...paneFind.findBarProps} /> : null;
}

function FilePaneCenterState({ children }: FilePaneCenterStateProps) {
  return <View style={styles.centerState}>{children}</View>;
}

function isLineSelected(lineSelection: FileLineSelection | null, lineNumber: number): boolean {
  if (!lineSelection) {
    return false;
  }
  return lineNumber >= lineSelection.lineStart && lineNumber <= lineSelection.lineEnd;
}

function FilePaneTextPreview({
  currentMatchBackgroundColor,
  findHighlightsByLine,
  gutterWidth,
  isMarkdownFile,
  isMobile,
  lineSelection,
  markdownParser,
  markdownRules,
  markdownStyles,
  matchBackgroundColor,
  preview,
  previewScrollRef,
  scrollbar,
  showDesktopWebScrollbar,
  textRenderData,
  textScrollRefs,
  webScrollbarStyle,
}: FilePaneTextPreviewProps) {
  if (isMarkdownFile) {
    return (
      <>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewMarkdownScrollContent}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          <AppearanceStyleBoundary>
            <Markdown style={markdownStyles} rules={markdownRules} markdownit={markdownParser}>
              {preview.content ?? ""}
            </Markdown>
          </AppearanceStyleBoundary>
        </RNScrollView>
        {scrollbar.overlay}
      </>
    );
  }

  const lines = textRenderData?.lines ?? [
    {
      lineNumber: 1,
      text: preview.content ?? "",
      tokens: [{ text: preview.content ?? "", style: null }],
    },
  ];
  const keyedLines = lines.map((line) => ({
    key: `line-${line.lineNumber}`,
    line,
  }));
  const codeLines = (
    <View dataSet={CODE_SURFACE_DATASET}>
      {keyedLines.map(({ key, line }) => (
        <CodeLine
          key={key}
          segments={createFilePaneFindTokenSegments(
            line,
            findHighlightsByLine.get(line.lineNumber) ?? [],
          )}
          lineNumber={line.lineNumber}
          gutterWidth={gutterWidth}
          highlighted={isLineSelected(lineSelection, line.lineNumber)}
          matchBackgroundColor={matchBackgroundColor}
          currentMatchBackgroundColor={currentMatchBackgroundColor}
          onLineRef={textScrollRefs.registerLineRef}
        />
      ))}
    </View>
  );

  return (
    <>
      <RNScrollView
        ref={previewScrollRef}
        style={styles.previewContent}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
      >
        {isMobile ? (
          <View style={styles.previewCodeScrollContent}>{codeLines}</View>
        ) : (
          <RNScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            style={webScrollbarStyle}
            contentContainerStyle={styles.previewCodeScrollContent}
          >
            {codeLines}
          </RNScrollView>
        )}
      </RNScrollView>
      {scrollbar.overlay}
    </>
  );
}

function FilePaneSearchableTextPreview(props: FilePaneSearchableTextPreviewProps) {
  const { findHighlightsByLine, paneFind } = useFilePaneFindAdapter({
    textRenderData: props.textRenderData,
    textScrollRefs: props.textScrollRefs,
  });

  return (
    <>
      <FilePaneFindBarSlot paneFind={paneFind} />
      <FilePaneTextPreview {...props} findHighlightsByLine={findHighlightsByLine} />
    </>
  );
}

function FilePaneImagePreview({
  imagePreviewUri,
  imageSource,
  previewScrollRef,
  scrollbar,
  showDesktopWebScrollbar,
}: FilePaneImagePreviewProps) {
  if (!imagePreviewUri) {
    return (
      <FilePaneCenterState>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>Loading file…</Text>
      </FilePaneCenterState>
    );
  }

  return (
    <>
      <RNScrollView
        ref={previewScrollRef}
        style={styles.previewContent}
        contentContainerStyle={styles.previewImageScrollContent}
        onLayout={scrollbar.onLayout}
        onScroll={scrollbar.onScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
      >
        <RNImage
          source={imageSource ?? undefined}
          style={styles.previewImage}
          resizeMode="contain"
        />
      </RNScrollView>
      {scrollbar.overlay}
    </>
  );
}

function FilePreviewBody({
  preview,
  isLoading,
  showDesktopWebScrollbar,
  isMobile,
  location,
  imagePreviewUri,
}: FilePreviewBodyProps) {
  const { t } = useTranslation("app");
  const { theme } = useUnistyles();
  const filePath = location.path;
  const isDark = theme.colorScheme === "dark";
  const matchBackgroundColor = isDark ? "rgba(250, 204, 21, 0.32)" : "rgba(250, 204, 21, 0.38)";
  const currentMatchBackgroundColor = isDark
    ? "rgba(251, 146, 60, 0.58)"
    : "rgba(251, 146, 60, 0.48)";
  const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
  const markdownParser = useMemo(() => MarkdownIt({ typographer: true, linkify: true }), []);
  const markdownRules = useMemo(() => createFilePreviewMarkdownRules(), []);
  const isMarkdownFile =
    preview?.kind === "text" && isRenderedMarkdownFile(filePath) && !location.lineStart;

  const fallbackScrollRef = useRef<RNScrollView>(null);
  const webScrollbarStyle = useWebScrollbarStyle();

  const textRenderData = useMemo(() => {
    if (!preview || preview.kind !== "text" || isMarkdownFile) {
      return null;
    }

    return createFilePaneTextRenderData(preview.content ?? "", filePath);
  }, [isMarkdownFile, preview, filePath]);
  const textLineNumbers = useMemo(
    () => textRenderData?.lines.map((line) => line.lineNumber) ?? null,
    [textRenderData],
  );
  const textScrollRefs = useFilePaneTextScrollRefs(textLineNumbers);
  const previewScrollRef = textRenderData ? textScrollRefs.previewScrollRef : fallbackScrollRef;
  const scrollbar = useWebScrollViewScrollbar(previewScrollRef, {
    enabled: showDesktopWebScrollbar,
  });
  const gutterWidth = useMemo(() => {
    if (!textRenderData) return 0;
    return lineNumberGutterWidth(textRenderData.lines.length, theme.fontSize.code);
  }, [textRenderData, theme.fontSize.code]);
  const lineHeight = theme.fontSize.code * 1.45;
  const lineSelection = useMemo(() => {
    if (!textRenderData) {
      return null;
    }
    return clampLineSelection({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      lineCount: textRenderData.lines.length,
    });
  }, [textRenderData, location.lineEnd, location.lineStart]);

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

  useEffect(() => {
    if (!lineSelection) {
      return;
    }
    const timeout = setTimeout(() => {
      previewScrollRef.current?.scrollTo({
        y: Math.max(0, (lineSelection.lineStart - 1) * lineHeight),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [lineHeight, lineSelection, previewScrollRef]);

  let content: React.ReactNode;
  if (isLoading && !preview) {
    content = (
      <FilePaneCenterState>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>{t("files.preview.loading")}</Text>
      </FilePaneCenterState>
    );
  } else if (!preview) {
    content = (
      <FilePaneCenterState>
        <Text style={styles.emptyText}>{t("files.preview.noPreview")}</Text>
      </FilePaneCenterState>
    );
  } else if (preview.kind === "text" && textRenderData) {
    content = (
      <FilePaneSearchableTextPreview
        currentMatchBackgroundColor={currentMatchBackgroundColor}
        gutterWidth={gutterWidth}
        isMarkdownFile={isMarkdownFile}
        isMobile={isMobile}
        lineSelection={lineSelection}
        markdownParser={markdownParser}
        markdownRules={markdownRules}
        markdownStyles={markdownStyles}
        matchBackgroundColor={matchBackgroundColor}
        preview={preview}
        previewScrollRef={previewScrollRef}
        scrollbar={scrollbar}
        showDesktopWebScrollbar={showDesktopWebScrollbar}
        textRenderData={textRenderData}
        textScrollRefs={textScrollRefs}
        webScrollbarStyle={webScrollbarStyle}
      />
    );
  } else if (preview.kind === "text") {
    content = (
      <FilePaneTextPreview
        currentMatchBackgroundColor={currentMatchBackgroundColor}
        findHighlightsByLine={new Map()}
        gutterWidth={gutterWidth}
        isMarkdownFile={isMarkdownFile}
        isMobile={isMobile}
        lineSelection={lineSelection}
        markdownParser={markdownParser}
        markdownRules={markdownRules}
        markdownStyles={markdownStyles}
        matchBackgroundColor={matchBackgroundColor}
        preview={preview}
        previewScrollRef={previewScrollRef}
        scrollbar={scrollbar}
        showDesktopWebScrollbar={showDesktopWebScrollbar}
        textRenderData={textRenderData}
        textScrollRefs={textScrollRefs}
        webScrollbarStyle={webScrollbarStyle}
      />
    );
  } else if (preview.kind === "image") {
    content = (
      <FilePaneImagePreview
        imagePreviewUri={imagePreviewUri}
        imageSource={imageSource}
        previewScrollRef={previewScrollRef}
        scrollbar={scrollbar}
        showDesktopWebScrollbar={showDesktopWebScrollbar}
      />
    );
  } else {
    content = (
      <FilePaneCenterState>
        <Text style={styles.emptyText}>{t("files.preview.binaryUnavailable")}</Text>
        <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
      </FilePaneCenterState>
    );
  }

  return <View style={styles.previewScrollContainer}>{content}</View>;
}

export function FilePane({
  serverId,
  workspaceRoot,
  location,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
}) {
  const { t } = useTranslation("app");
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: normalizedWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, normalizedWorkspaceRoot],
  );

  const query = useQuery({
    queryKey: ["workspaceFile", serverId, readTarget?.cwd ?? null, readTarget?.path ?? null],
    enabled: Boolean(client && readTarget),
    queryFn: async () => {
      if (!client || !readTarget) {
        return { file: null as ExplorerFile | null, error: t("files.error.hostNotConnected") };
      }
      try {
        const file = await client.readFile(readTarget.cwd, readTarget.path);
        const preview = await createFilePanePreview(file);
        return {
          file: preview.file,
          imageAttachment: preview.imageAttachment,
          error: null,
        };
      } catch (error) {
        return {
          file: null,
          imageAttachment: null,
          error: error instanceof Error ? error.message : t("files.error.loadFailed"),
        };
      }
    },
    staleTime: 5_000,
    refetchOnMount: true,
  });
  const imagePreviewUri = useAttachmentPreviewUrl(query.data?.imageAttachment ?? null);

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {query.data?.error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{query.data.error}</Text>
        </View>
      ) : null}

      <FilePreviewBody
        preview={query.data?.file ?? null}
        isLoading={query.isFetching}
        showDesktopWebScrollbar={showDesktopWebScrollbar}
        isMobile={isMobile}
        location={location}
        imagePreviewUri={imagePreviewUri}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
  previewMarkdownScrollContent: {
    padding: theme.spacing[4],
  },
  previewImageScrollContent: {
    flexGrow: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 420,
  },
}));
