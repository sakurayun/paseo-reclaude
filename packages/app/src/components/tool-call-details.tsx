import React, { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  View,
  Text,
  ScrollView as RNScrollView,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { buildLineDiff, parseUnifiedDiff, type DiffLine } from "@/utils/tool-call-parsers";
import { highlightDiffLines } from "@/utils/diff-highlight";
import { hasMeaningfulToolCallDetail } from "@/utils/tool-call-detail-state";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { useSettings } from "@/hooks/use-settings";
import { resolveTerminalPalette } from "@/constants/terminal-color-presets";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { monoLigatureInlineWebStyle, monoLigatureTextStyle } from "@/styles/mono-ligatures";
import type { Theme } from "@/styles/theme";
import { extensionFromPath, highlightToKeyedLines } from "@/utils/highlight-cache";
import { HighlightedLines } from "./highlighted-content";
import { DiffViewer } from "./diff-viewer";
import { AnsiText } from "./ansi-text";
import { getCodeInsets } from "./code-insets";
import { isWeb } from "@/constants/platform";
import { ansiToPlainText, mapRawRangeToVisible } from "@/utils/ansi-spans";
// Type-only import keeps the message <-> tool-call-details cycle compile-time only.
import type { MessageFindHighlight } from "./message";

const ScrollView = isWeb ? RNScrollView : GHScrollView;

// ---- Content Component ----

interface ToolCallDetailsContentProps {
  detail?: ToolCallDetail;
  errorText?: string;
  maxHeight?: number;
  fillAvailableHeight?: boolean;
  showLoadingSkeleton?: boolean;
  followContentEnd?: boolean;
  /** Find highlights keyed by detail segment (shell.command, shell.output, …). */
  findHighlights?: Map<string, MessageFindHighlight[]>;
}

interface DetailStyles {
  sectionFillStyle: StyleProp<ViewStyle>;
  codeBlockFillStyle: StyleProp<ViewStyle>;
  codeVerticalScrollStyle: StyleProp<ViewStyle>;
  scrollAreaFillStyle: StyleProp<ViewStyle>;
  scrollAreaStyle: StyleProp<ViewStyle>;
  jsonBlockCombined: StyleProp<ViewStyle>;
  jsonBlockErrorCombined: StyleProp<ViewStyle>;
  fullBleedContainerStyle: StyleProp<ViewStyle>;
  loadingContainerStyle: StyleProp<ViewStyle>;
  webScrollbarStyle: StyleProp<ViewStyle>;
  resolvedMaxHeight: number | undefined;
  shouldFill: boolean;
  isFullBleed: boolean;
}

function resolveIsFullBleed(detail: ToolCallDetail | undefined): boolean {
  return detail?.type === "edit" || detail?.type === "shell" || detail?.type === "write";
}

function resolveShouldFill(
  detail: ToolCallDetail | undefined,
  fillAvailableHeight: boolean,
): boolean {
  if (!fillAvailableHeight) return false;
  const t = detail?.type;
  return t === "shell" || t === "edit" || t === "write" || t === "read" || t === "sub_agent";
}

function useDetailStyles(
  detail: ToolCallDetail | undefined,
  resolvedMaxHeight: number | undefined,
  fillAvailableHeight: boolean,
): DetailStyles {
  const webScrollbarStyle = useWebScrollbarStyle("subtle");
  const isFullBleed = resolveIsFullBleed(detail);
  const shouldFill = resolveShouldFill(detail, fillAvailableHeight);
  const codeBlockStyle = isFullBleed ? styles.fullBleedBlock : styles.diffContainer;

  const sectionFillStyle = useMemo(
    () => [styles.section, shouldFill && styles.fillHeight],
    [shouldFill],
  );
  const codeBlockFillStyle = useMemo(
    () => [codeBlockStyle, shouldFill && styles.fillHeight],
    [codeBlockStyle, shouldFill],
  );
  const codeVerticalScrollStyle = useMemo(
    () => [
      styles.codeVerticalScroll,
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
      shouldFill && styles.fillHeight,
      webScrollbarStyle,
    ],
    [resolvedMaxHeight, shouldFill, webScrollbarStyle],
  );
  const scrollAreaFillStyle = useMemo(
    () => [
      styles.scrollArea,
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
      shouldFill && styles.fillHeight,
      webScrollbarStyle,
    ],
    [resolvedMaxHeight, shouldFill, webScrollbarStyle],
  );
  const scrollAreaStyle = useMemo(
    () => [
      styles.scrollArea,
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
      webScrollbarStyle,
    ],
    [resolvedMaxHeight, webScrollbarStyle],
  );
  const jsonBlockCombined = useMemo(() => [styles.jsonScroll, styles.jsonContent], []);
  const jsonBlockErrorCombined = useMemo(
    () => [styles.jsonScroll, styles.jsonScrollError, styles.jsonContent],
    [],
  );
  const fullBleedContainerStyle = useMemo(
    () => [
      isFullBleed ? styles.fullBleedContainer : styles.paddedContainer,
      shouldFill && styles.fillHeight,
    ],
    [isFullBleed, shouldFill],
  );
  const loadingContainerStyle = useMemo(
    () => [styles.loadingContainer, fillAvailableHeight && styles.fillHeight],
    [fillAvailableHeight],
  );

  return {
    sectionFillStyle,
    codeBlockFillStyle,
    codeVerticalScrollStyle,
    scrollAreaFillStyle,
    scrollAreaStyle,
    jsonBlockCombined,
    jsonBlockErrorCombined,
    fullBleedContainerStyle,
    loadingContainerStyle,
    webScrollbarStyle,
    resolvedMaxHeight,
    shouldFill,
    isFullBleed,
  };
}

function useDiffLines(detail: ToolCallDetail | undefined): DiffLine[] | undefined {
  return useMemo(() => {
    if (!detail || detail.type !== "edit") return undefined;
    const diffLines = detail.unifiedDiff
      ? parseUnifiedDiff(detail.unifiedDiff)
      : buildLineDiff(detail.oldString ?? "", detail.newString ?? "");
    return highlightDiffLines(diffLines, detail.filePath);
  }, [detail]);
}

interface ShellDetailProps {
  command: string;
  output: string | null | undefined;
  ds: DetailStyles;
  findHighlights?: Map<string, MessageFindHighlight[]>;
}

// Output is rendered with leading newlines stripped, so shift its highlight
// offsets to keep them aligned with the trimmed string. When the source still
// carries ANSI codes, re-map raw offsets onto the visible (stripped) text so
// find highlights land on the glyphs the user actually sees.
function shiftShellHighlights(
  highlights: MessageFindHighlight[] | undefined,
  delta: number,
): MessageFindHighlight[] | undefined {
  if (!highlights || delta === 0) {
    return highlights;
  }
  return highlights.map((highlight) => ({
    ...highlight,
    start: highlight.start + delta,
    end: highlight.end + delta,
  }));
}

/**
 * Map find-highlight offsets from a raw string (which may still include ANSI
 * CSI) onto the visible plain-text offsets used by AnsiText.
 */
function mapHighlightsToVisibleText(
  rawText: string,
  highlights: MessageFindHighlight[] | undefined,
): MessageFindHighlight[] | undefined {
  if (!highlights || highlights.length === 0) return highlights;
  if (!rawText.includes("\u001b")) return highlights;

  const mapped: MessageFindHighlight[] = [];
  for (const highlight of highlights) {
    const range = mapRawRangeToVisible(rawText, highlight.start, highlight.end);
    if (range.end <= range.start) continue;
    mapped.push({ ...highlight, start: range.start, end: range.end });
  }
  return mapped.length > 0 ? mapped : undefined;
}

interface ShellDetailSectionThemeProps {
  /** Active theme's terminal palette — used when the scheme is "auto". */
  themeTerminal: Theme["colors"]["terminal"];
  monoFontFamily: string;
  monoLigatures: boolean;
}

function ShellDetailSectionBase({
  command,
  output,
  ds,
  findHighlights,
  themeTerminal,
  monoFontFamily,
  monoLigatures,
}: ShellDetailProps & ShellDetailSectionThemeProps) {
  const terminalColorScheme = useSettings((settings) => settings.terminalColorScheme);
  // Prefer the settings toggle (source of truth for the terminal); theme.monoLigatures
  // is patched from the same flag via applyAppearance and stays as a fallback.
  const terminalLigaturesEnabled = useSettings((settings) => settings.terminalLigaturesEnabled);

  const palette = useMemo(
    () => resolveTerminalPalette(terminalColorScheme, themeTerminal),
    [terminalColorScheme, themeTerminal],
  );
  const ligaturesEnabled = terminalLigaturesEnabled ?? monoLigatures;

  const normalizedCommand = command.replace(/\n+$/, "");
  const rawOutput = output ?? "";
  const commandOutput = rawOutput.replace(/^\n+/, "");
  const hasOutput = commandOutput.length > 0;
  const trimmedDelta = commandOutput.length - rawOutput.length;
  const commandHighlights = mapHighlightsToVisibleText(
    normalizedCommand,
    findHighlights?.get("shell.command"),
  );
  const outputHighlights = mapHighlightsToVisibleText(
    commandOutput,
    shiftShellHighlights(findHighlights?.get("shell.output"), trimmedDelta),
  );

  // Compose a single ANSI document: green `$ ` prompt + command + blank line +
  // output. One AnsiText pass keeps selection continuous across the card.
  const shellDocument = useMemo(() => {
    const prompt = "\u001b[32m$ \u001b[0m";
    if (!hasOutput) {
      return `${prompt}${normalizedCommand}`;
    }
    return `${prompt}${normalizedCommand}\n\n${commandOutput}`;
  }, [commandOutput, hasOutput, normalizedCommand]);

  const documentHighlights = useMemo(() => {
    // Prompt is 2 visible chars (`$ `). Command highlights shift by that.
    // Output starts after command + "\n\n".
    const promptVisibleLen = 2;
    const commandVisibleLen = ansiToPlainText(normalizedCommand).length;
    const outputStart = promptVisibleLen + commandVisibleLen + (hasOutput ? 2 : 0);

    const merged: MessageFindHighlight[] = [];
    for (const highlight of commandHighlights ?? []) {
      merged.push({
        ...highlight,
        start: highlight.start + promptVisibleLen,
        end: highlight.end + promptVisibleLen,
      });
    }
    for (const highlight of outputHighlights ?? []) {
      merged.push({
        ...highlight,
        start: highlight.start + outputStart,
        end: highlight.end + outputStart,
      });
    }
    return merged.length > 0 ? merged : undefined;
  }, [commandHighlights, hasOutput, normalizedCommand, outputHighlights]);

  const shellBlockStyle = useMemo(
    () => [
      ds.codeBlockFillStyle,
      // Resolved scheme background so Dracula/One Dark/etc. match the terminal pane.
      inlineUnistylesStyle({ backgroundColor: palette.background }),
    ],
    [ds.codeBlockFillStyle, palette.background],
  );

  const shellTextStyle = useMemo(
    () => [
      styles.shellAnsiText,
      inlineUnistylesStyle({
        color: palette.foreground,
        fontFamily: monoFontFamily,
      }),
      monoLigatureTextStyle(ligaturesEnabled),
      monoLigatureInlineWebStyle(ligaturesEnabled),
    ],
    [palette.foreground, monoFontFamily, ligaturesEnabled],
  );

  return (
    <View style={ds.sectionFillStyle}>
      <View style={shellBlockStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <View style={styles.codeHorizontalContent}>
            <View style={styles.shellCodeLine} dataSet={CODE_SURFACE_DATASET}>
              <AnsiText
                text={shellDocument}
                style={shellTextStyle}
                findHighlights={documentHighlights}
                palette={palette}
                ligaturesEnabled={ligaturesEnabled}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// Inject theme terminal palette + mono face without useUnistyles (banned).
// Only this leaf re-renders on theme changes; settings drive the scheme override.
const ShellDetailSection = withUnistyles(ShellDetailSectionBase, (theme: Theme) => ({
  themeTerminal: theme.colors.terminal,
  monoFontFamily: theme.fontFamily.mono,
  monoLigatures: theme.monoLigatures,
}));

interface WorktreeSetupDetailProps {
  log: string;
  branchName: string;
  worktreePath: string;
  ds: DetailStyles;
}

function WorktreeSetupDetailSection({
  log,
  branchName,
  worktreePath,
  ds,
}: WorktreeSetupDetailProps) {
  const setupLog = log.replace(/^\n+/, "");
  const hasLog = setupLog.length > 0;
  return (
    <View style={ds.sectionFillStyle}>
      <View style={ds.codeBlockFillStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <View style={styles.codeHorizontalContent}>
            <View style={styles.codeLine} dataSet={CODE_SURFACE_DATASET}>
              <Text selectable style={styles.scrollText}>
                {hasLog ? setupLog : `Preparing worktree ${branchName} at ${worktreePath}`}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function resolveSubAgentFallbackHeader(
  subAgentType: string | null | undefined,
  description: string | null | undefined,
  fallbackText: string,
): string {
  if (subAgentType && description) {
    return `${subAgentType}: ${description}`;
  }
  return subAgentType ?? description ?? fallbackText;
}

interface SubAgentDetailProps {
  log: string;
  childSessionId: string | null | undefined;
  subAgentType: string | null | undefined;
  description: string | null | undefined;
  ds: DetailStyles;
}

interface SubAgentActivityRow {
  index: number;
  toolName: string;
  summary?: string;
}

interface ParsedSubAgentLog {
  actions: SubAgentActivityRow[];
  remainingLog: string;
}

function parseBracketedSubAgentLine(line: string, index: number): SubAgentActivityRow | null {
  const match = line.match(/^\[([^\]]+)\](?:\s+(.*))?$/);
  if (!match) {
    return null;
  }
  const toolName = match[1]?.trim();
  if (!toolName) {
    return null;
  }
  const summary = match[2]?.trim();
  return {
    index,
    toolName,
    ...(summary ? { summary } : {}),
  };
}

function parseSubAgentLog(log: string): ParsedSubAgentLog {
  const actions: SubAgentActivityRow[] = [];
  const remainingLines: string[] = [];
  for (const line of log.replace(/^\n+/, "").split("\n")) {
    const normalizedLine = line.trim();
    if (!normalizedLine) {
      continue;
    }
    const parsedAction = parseBracketedSubAgentLine(normalizedLine, actions.length + 1);
    if (parsedAction) {
      actions.push(parsedAction);
    } else {
      remainingLines.push(line);
    }
  }
  return {
    actions,
    remainingLog: remainingLines.join("\n").replace(/^\n+/, ""),
  };
}

function SubAgentActionRow({ action }: { action: SubAgentActivityRow }) {
  return (
    <View style={styles.subAgentActionRow}>
      <Text selectable style={styles.subAgentActionTool}>
        {formatSubAgentToolName(action.toolName)}
      </Text>
      {action.summary ? (
        <Text selectable style={styles.subAgentActionSummary}>
          {action.summary}
        </Text>
      ) : null}
    </View>
  );
}

function formatSubAgentToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return toolName;
  }
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function SubAgentLogText({
  activityLog,
  fallbackHeader,
  hasActions,
}: {
  activityLog: string;
  fallbackHeader: string;
  hasActions: boolean;
}) {
  if (activityLog.length > 0) {
    return (
      <Text selectable style={styles.scrollText}>
        {activityLog}
      </Text>
    );
  }
  if (!hasActions) {
    return (
      <Text selectable style={styles.scrollText}>
        {fallbackHeader}
      </Text>
    );
  }
  return null;
}

function SubAgentDetailSection({
  log,
  childSessionId,
  subAgentType,
  description,
  ds,
}: SubAgentDetailProps) {
  const { t } = useTranslation();
  const { actions, remainingLog } = useMemo(() => parseSubAgentLog(log), [log]);
  const fallbackHeader = resolveSubAgentFallbackHeader(
    subAgentType,
    description,
    t("toolCallDetails.subAgentActivity"),
  );
  const hasActions = actions.length > 0;
  return (
    <View style={ds.sectionFillStyle}>
      <View style={ds.codeBlockFillStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <View style={styles.codeHorizontalContent}>
            <View style={styles.codeLine} dataSet={CODE_SURFACE_DATASET}>
              {childSessionId ? (
                <Text selectable style={styles.subAgentSessionText}>
                  session {childSessionId}
                </Text>
              ) : null}
              {hasActions ? (
                <View style={styles.subAgentActions}>
                  {actions.map((action) => (
                    <SubAgentActionRow key={action.index} action={action} />
                  ))}
                </View>
              ) : null}
              <SubAgentLogText
                activityLog={remainingLog}
                fallbackHeader={fallbackHeader}
                hasActions={hasActions}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

interface EditDetailProps {
  diffLines: DiffLine[] | undefined;
  ds: DetailStyles;
}

function EditDetailSection({ diffLines, ds }: EditDetailProps) {
  return (
    <View style={ds.sectionFillStyle}>
      {diffLines ? (
        <View style={ds.codeBlockFillStyle}>
          <DiffViewer
            diffLines={diffLines}
            maxHeight={ds.resolvedMaxHeight}
            fillAvailableHeight={ds.shouldFill}
          />
        </View>
      ) : null}
    </View>
  );
}

interface ScrollableContentProps {
  content: string;
  ds: DetailStyles;
  wrapInSectionFill?: boolean;
  // Drives syntax highlighting (extension only) and, with startLine, a gutter.
  filePath?: string | null;
  startLine?: number;
}

function ScrollableTextSection({
  content,
  ds,
  wrapInSectionFill = true,
  filePath,
  startLine,
}: ScrollableContentProps) {
  const keyedLines = useMemo(
    () => (filePath ? highlightToKeyedLines(content, extensionFromPath(filePath)) : null),
    [content, filePath],
  );
  const body = (
    <ScrollView
      style={ds.scrollAreaFillStyle}
      contentContainerStyle={styles.scrollContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator={true}
    >
      {keyedLines ? (
        <HighlightedLines lines={keyedLines} startLine={startLine} />
      ) : (
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {content}
        </Text>
      )}
    </ScrollView>
  );
  if (!wrapInSectionFill) return body;
  return <View style={ds.sectionFillStyle}>{body}</View>;
}

interface FetchDetailProps {
  url: string;
  result: string | null | undefined;
  ds: DetailStyles;
}

function FetchDetailSection({ url, result, ds }: FetchDetailProps) {
  return (
    <View style={ds.sectionFillStyle}>
      <ScrollView
        style={ds.scrollAreaFillStyle}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {result ? `${url}\n\n${result}` : url}
        </Text>
      </ScrollView>
    </View>
  );
}

function ScrollablePlainTextSection({
  text,
  ds,
  followContentEnd = false,
}: {
  text: string;
  ds: DetailStyles;
  followContentEnd?: boolean;
}) {
  const scrollRef = React.useRef<React.ElementRef<typeof ScrollView>>(null);
  const handleContentSizeChange = React.useCallback(() => {
    if (followContentEnd) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [followContentEnd]);

  return (
    <View style={styles.section}>
      <ScrollView
        ref={scrollRef}
        style={ds.scrollAreaStyle}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={handleContentSizeChange}
      >
        <Text selectable style={styles.plainText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

interface SearchDetail {
  query?: string;
  content?: string;
  filePaths?: string[];
  webResults?: { title: string; url: string }[];
  annotations?: string[];
}

function buildSearchSections(detail: SearchDetail, ds: DetailStyles): ReactNode[] {
  const out: ReactNode[] = [];
  if (detail.content) {
    out.push(
      <View key="search-content" style={styles.section}>
        <ScrollView
          style={ds.scrollAreaStyle}
          contentContainerStyle={styles.scrollContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
            {detail.content}
          </Text>
        </ScrollView>
      </View>,
    );
  }
  if (detail.filePaths && detail.filePaths.length > 0) {
    out.push(
      <View key="search-files" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.filePaths.join("\n")}
        </Text>
      </View>,
    );
  }
  if (detail.webResults && detail.webResults.length > 0) {
    out.push(
      <View key="search-web-results" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.webResults.map((entry) => `${entry.title}\n${entry.url}`).join("\n\n")}
        </Text>
      </View>,
    );
  }
  if (detail.annotations && detail.annotations.length > 0) {
    out.push(
      <View key="search-annotations" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.annotations.join("\n\n")}
        </Text>
      </View>,
    );
  }
  return out;
}

function serializeUnknownValue(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface UnknownDetail {
  input: unknown;
  output: unknown;
}

const UNKNOWN_SECTION_TITLE_KEY = {
  input: "toolCallDetails.input",
  output: "toolCallDetails.output",
} as const;

function buildUnknownSections(
  detail: UnknownDetail,
  ds: DetailStyles,
  t: TFunction,
  followContentEnd: boolean,
): ReactNode[] {
  const plainInputText =
    typeof detail.input === "string" && detail.output === null ? detail.input : null;

  if (plainInputText !== null) {
    return [
      <ScrollablePlainTextSection
        key="unknown-plain-text"
        text={plainInputText}
        ds={ds}
        followContentEnd={followContentEnd}
      />,
    ];
  }

  const sectionsFromTopLevel = [
    { id: "input" as const, value: detail.input },
    { id: "output" as const, value: detail.output },
  ].filter((entry) =>
    hasMeaningfulToolCallDetail({
      type: "unknown",
      input: entry.value ?? null,
      output: null,
    }),
  );

  const out: ReactNode[] = [];
  for (const section of sectionsFromTopLevel) {
    const value = serializeUnknownValue(section.value);
    if (!value.length) {
      continue;
    }
    out.push(
      <View key={`${section.id}-header`} style={styles.groupHeader}>
        <Text style={styles.groupHeaderText}>{t(UNKNOWN_SECTION_TITLE_KEY[section.id])}</Text>
      </View>,
    );
    out.push(
      <View key={`${section.id}-value`} style={styles.section}>
        <View style={ds.jsonBlockCombined}>
          <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
            {value}
          </Text>
        </View>
      </View>,
    );
  }
  return out;
}

function buildDetailSections(
  detail: ToolCallDetail | undefined,
  diffLines: DiffLine[] | undefined,
  ds: DetailStyles,
  t: TFunction,
  findHighlights: Map<string, MessageFindHighlight[]> | undefined,
  followContentEnd: boolean,
): ReactNode[] {
  if (!detail) return [];
  if (detail.type === "shell") {
    return [
      <ShellDetailSection
        key="shell"
        command={detail.command}
        output={detail.output}
        ds={ds}
        findHighlights={findHighlights}
      />,
    ];
  }
  if (detail.type === "worktree_setup") {
    return [
      <WorktreeSetupDetailSection
        key="worktree-setup"
        log={detail.log}
        branchName={detail.branchName}
        worktreePath={detail.worktreePath}
        ds={ds}
      />,
    ];
  }
  if (detail.type === "sub_agent") {
    return [
      <SubAgentDetailSection
        key="sub-agent"
        log={detail.log}
        childSessionId={detail.childSessionId}
        subAgentType={detail.subAgentType}
        description={detail.description}
        ds={ds}
      />,
    ];
  }
  if (detail.type === "edit") {
    return [<EditDetailSection key="edit" diffLines={diffLines} ds={ds} />];
  }
  if (detail.type === "write") {
    return [
      <View key="write" style={ds.sectionFillStyle}>
        {detail.content ? (
          <ScrollableTextSection
            content={detail.content}
            ds={ds}
            wrapInSectionFill={false}
            filePath={detail.filePath}
          />
        ) : null}
      </View>,
    ];
  }
  if (detail.type === "read") {
    if (!detail.content) return [];
    return [
      <ScrollableTextSection
        key="read"
        content={detail.content}
        ds={ds}
        filePath={detail.filePath}
        startLine={detail.offset ?? 1}
      />,
    ];
  }
  if (detail.type === "search") {
    return buildSearchSections(detail, ds);
  }
  if (detail.type === "fetch") {
    return [<FetchDetailSection key="fetch" url={detail.url} result={detail.result} ds={ds} />];
  }
  if (detail.type === "plain_text") {
    if (!detail.text) return [];
    return [
      <ScrollablePlainTextSection
        key="plain-text"
        text={detail.text}
        ds={ds}
        followContentEnd={followContentEnd}
      />,
    ];
  }
  if (detail.type === "unknown") {
    return buildUnknownSections(detail, ds, t, followContentEnd);
  }
  return [];
}

function ErrorSection({ errorText, ds }: { errorText: string; ds: DetailStyles }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text style={SECTION_TITLE_ERROR_STYLE}>{t("toolCallDetails.error")}</Text>
      <View style={ds.jsonBlockErrorCombined}>
        <Text selectable style={SCROLL_TEXT_ERROR_STYLE} dataSet={CODE_SURFACE_DATASET}>
          {errorText}
        </Text>
      </View>
    </View>
  );
}

function LoadingSkeleton({ containerStyle }: { containerStyle: StyleProp<ViewStyle> }) {
  return (
    <View style={containerStyle}>
      <View style={styles.loadingLineWide} />
      <View style={styles.loadingLineMedium} />
      <View style={styles.loadingLineShort} />
    </View>
  );
}

export function ToolCallDetailsContent({ ...props }: ToolCallDetailsContentProps) {
  return (
    <AppearanceStyleBoundary>
      <ToolCallDetailsContentInner {...props} />
    </AppearanceStyleBoundary>
  );
}

function ToolCallDetailsContentInner({
  detail,
  errorText,
  maxHeight,
  fillAvailableHeight = false,
  showLoadingSkeleton = false,
  followContentEnd = false,
  findHighlights,
}: ToolCallDetailsContentProps) {
  const { t } = useTranslation();
  const resolvedMaxHeight = fillAvailableHeight ? undefined : (maxHeight ?? 300);
  const ds = useDetailStyles(detail, resolvedMaxHeight, fillAvailableHeight);
  const diffLines = useDiffLines(detail);

  const sections: ReactNode[] = buildDetailSections(
    detail,
    diffLines,
    ds,
    t,
    findHighlights,
    followContentEnd,
  );

  if (errorText) {
    sections.push(<ErrorSection key="error" errorText={errorText} ds={ds} />);
  }

  if (sections.length === 0) {
    if (showLoadingSkeleton) {
      return <LoadingSkeleton containerStyle={ds.loadingContainerStyle} />;
    }
    return <Text style={styles.emptyStateText}>{t("toolCallDetails.empty")}</Text>;
  }

  return <View style={ds.fullBleedContainerStyle}>{sections}</View>;
}

// ---- Styles ----

const styles = StyleSheet.create((theme) => {
  const insets = getCodeInsets(theme);

  return {
    paddedContainer: {
      gap: theme.spacing[4],
      padding: theme.spacing[3],
      // The tool call title row above already provides vertical breathing
      // room; a full top inset here would double it.
      paddingTop: theme.spacing[1],
    },
    fullBleedContainer: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
      paddingTop: theme.spacing[1],
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      // The padded container already insets content; keep headers flush with
      // the card edges below them.
      paddingHorizontal: 0,
      paddingBottom: theme.spacing[1],
    },
    groupHeaderText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.normal,
    },
    section: {
      gap: theme.spacing[2],
    },
    fillHeight: {
      flex: 1,
      minHeight: 0,
    },
    plainText: {
      fontFamily: theme.fontFamily.ui,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
      lineHeight: Math.round(theme.fontSize.base * 1.4),
      overflowWrap: "anywhere",
    },
    sectionTitle: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.semibold,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    rangeText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.xs,
    },
    diffContainer: {
      borderRadius: theme.borderRadius.lg,
      overflow: "hidden",
      backgroundColor: theme.colors.surface2,
    },
    fullBleedBlock: {
      borderWidth: 0,
      borderRadius: theme.borderRadius.lg,
      overflow: "hidden",
      backgroundColor: theme.colors.surface2,
    },
    codeVerticalScroll: {},
    codeVerticalContent: {
      flexGrow: 1,
      paddingBottom: insets.extraBottom,
    },
    codeHorizontalContent: {
      paddingRight: insets.extraRight,
    },
    codeLine: {
      minWidth: "100%",
      paddingHorizontal: insets.padding,
      paddingVertical: insets.padding,
    },
    // Shell block background/foreground are applied at runtime from the
    // resolved terminal color scheme (see ShellDetailSectionBase). These
    // styles only own layout + the mono typeface.
    shellCodeLine: {
      minWidth: "100%",
      paddingHorizontal: insets.padding,
      paddingVertical: insets.padding,
    },
    shellAnsiText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
    },
    scrollArea: {
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface2,
    },
    scrollContent: {
      padding: insets.padding,
    },
    scrollText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foreground,
      lineHeight: Math.round(theme.fontSize.code * 1.5),
      ...(isWeb
        ? {
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }
        : null),
    },
    subAgentSessionText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      lineHeight: Math.round(theme.fontSize.code * 1.5),
      marginBottom: theme.spacing[2],
    },
    subAgentActions: {
      gap: theme.spacing[1],
      marginBottom: theme.spacing[2],
    },
    subAgentActionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    subAgentActionTool: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      lineHeight: Math.round(theme.fontSize.code * 1.5),
    },
    subAgentActionSummary: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foreground,
      lineHeight: Math.round(theme.fontSize.code * 1.5),
    },
    jsonScroll: {
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface2,
    },
    jsonScrollError: {
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.destructive,
    },
    jsonContent: {
      padding: insets.padding,
    },
    errorText: {
      color: theme.colors.destructive,
    },
    emptyStateText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      fontStyle: "italic",
    },
    loadingContainer: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
    },
    loadingLineWide: {
      height: 12,
      width: "100%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
    loadingLineMedium: {
      height: 12,
      width: "72%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
    loadingLineShort: {
      height: 12,
      width: "48%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
  };
});

const SECTION_TITLE_ERROR_STYLE = [styles.sectionTitle, styles.errorText];
const SCROLL_TEXT_ERROR_STYLE = [styles.scrollText, styles.errorText];
