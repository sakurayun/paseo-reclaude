import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Circle, Line, Path } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { GitLogCommit } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useToast } from "@/contexts/toast-context";
import { formatTimeAgo } from "@/utils/time";
import { isNative } from "@/constants/platform";
import type { CommitGraphEdge, CommitGraphRowLayout } from "./commit-graph-layout";
import { CommitAvatar } from "./commit-avatar";
import { CommitFilesList } from "./commit-files-list";

export const COMMIT_ROW_HEIGHT = 44;
export const GRAPH_LANE_WIDTH = 14;
const NODE_RADIUS = 3.5;
const EDGE_WIDTH = 1.5;

/**
 * Lane palette cycles through syntax-highlight hues — the only themed color
 * set with enough distinct, theme-tuned hues for both light and dark mode.
 */
const LANE_COLOR_KEYS = [
  "tag",
  "number",
  "function",
  "class",
  "keyword",
  "string",
  "attribute",
  "comment",
] as const;

function laneColor(laneColors: readonly string[], colorIndex: number): string {
  return laneColors[colorIndex % laneColors.length];
}

interface CommitGraphSvgProps {
  layout: CommitGraphRowLayout;
  width: number;
  /** Resolved theme colors, injected via withUnistyles uniProps. */
  laneColors: readonly string[];
}

/**
 * One row's slice of the commit graph. The theme wrapper must sit around the
 * whole component — wrapping individual SVG primitives with withUnistyles
 * inserts `<div style="display:contents">` INSIDE `<svg>` on web, which is
 * invalid SVG content and silently renders nothing.
 */
function CommitGraphSvg({ layout, width, laneColors }: CommitGraphSvgProps) {
  return (
    <Svg width={width} height={COMMIT_ROW_HEIGHT}>
      {layout.inEdges.map((edge) => (
        <Path
          key={`in-${edge.fromLane}-${edge.toLane}-${edge.kind}`}
          d={edgePath(edge, "top")}
          stroke={laneColor(laneColors, edge.colorIndex)}
          strokeWidth={EDGE_WIDTH}
          fill="none"
        />
      ))}
      {layout.outEdges.map((edge) => (
        <Path
          key={`out-${edge.fromLane}-${edge.toLane}-${edge.kind}`}
          d={edgePath(edge, "bottom")}
          stroke={laneColor(laneColors, edge.colorIndex)}
          strokeWidth={EDGE_WIDTH}
          fill="none"
        />
      ))}
      <Circle
        cx={laneCenterX(layout.lane)}
        cy={COMMIT_ROW_HEIGHT / 2}
        r={NODE_RADIUS}
        fill={laneColor(laneColors, layout.colorIndex)}
        stroke={laneColor(laneColors, layout.colorIndex)}
        strokeWidth={EDGE_WIDTH}
      />
    </Svg>
  );
}

const ThemedCommitGraphSvg = withUnistyles(CommitGraphSvg);

const laneColorsMapping = (theme: Theme) => ({
  laneColors: LANE_COLOR_KEYS.map((key) => theme.colors.syntax[key]),
});

interface ContinuingLane {
  lane: number;
  colorIndex: number;
}

interface ExpandedLaneGutterProps {
  lanes: readonly ContinuingLane[];
  width: number;
  /** Resolved theme colors, injected via withUnistyles uniProps. */
  laneColors: readonly string[];
}

/**
 * Vertical continuation of the graph lanes alongside a row's expanded
 * details, so opening a commit doesn't visually sever the swim lanes.
 * Drawn as SVG strokes (not Views) so they render identically to the
 * per-row graph lines. The gutter height is measured via onLayout and passed
 * to the SVG explicitly — percentage endpoints ("100%") don't reliably track
 * the dynamic expanded height when the details content grows (e.g. expanding
 * the file tree), leaving the lane line cut short.
 */
function ExpandedLaneGutter({ lanes, width, laneColors }: ExpandedLaneGutterProps) {
  const containerStyle = useMemo(() => [gutterStaticStyles.container, { width }], [width]);
  const [height, setHeight] = useState(0);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    setHeight(Math.ceil(event.nativeEvent.layout.height));
  }, []);
  return (
    <View style={containerStyle} pointerEvents="none" onLayout={handleLayout}>
      {height > 0 ? (
        <Svg style={gutterStaticStyles.svg} width={width} height={height}>
          {lanes.map((entry) => (
            <Line
              key={entry.lane}
              x1={laneCenterX(entry.lane)}
              y1={0}
              x2={laneCenterX(entry.lane)}
              y2={height}
              stroke={laneColor(laneColors, entry.colorIndex)}
              strokeWidth={EDGE_WIDTH}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const ThemedExpandedLaneGutter = withUnistyles(ExpandedLaneGutter);

function laneCenterX(lane: number): number {
  return lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function edgePath(edge: CommitGraphEdge, half: "top" | "bottom"): string {
  const midY = COMMIT_ROW_HEIGHT / 2;
  const fromX = laneCenterX(edge.fromLane);
  const toX = laneCenterX(edge.toLane);
  if (half === "top") {
    if (fromX === toX) {
      return `M ${fromX} 0 L ${toX} ${midY}`;
    }
    // Converge toward the node with a soft S-curve.
    return `M ${fromX} 0 C ${fromX} ${midY * 0.6}, ${toX} ${midY * 0.4}, ${toX} ${midY}`;
  }
  if (fromX === toX) {
    return `M ${fromX} ${midY} L ${toX} ${COMMIT_ROW_HEIGHT}`;
  }
  return `M ${fromX} ${midY} C ${fromX} ${midY * 1.6}, ${toX} ${midY * 1.4}, ${toX} ${COMMIT_ROW_HEIGHT}`;
}

interface RefBadge {
  label: string;
  kind: "head" | "branch" | "tag" | "remote";
}

function classifyRefs(refs: readonly string[]): RefBadge[] {
  const badges: RefBadge[] = [];
  for (const ref of refs) {
    if (ref.startsWith("HEAD -> ")) {
      badges.push({ label: ref.slice("HEAD -> ".length), kind: "head" });
    } else if (ref === "HEAD") {
      badges.push({ label: "HEAD", kind: "head" });
    } else if (ref.startsWith("tag: ")) {
      badges.push({ label: ref.slice("tag: ".length), kind: "tag" });
    } else if (ref.includes("/")) {
      badges.push({ label: ref, kind: "remote" });
    } else {
      badges.push({ label: ref, kind: "branch" });
    }
  }
  return badges;
}

interface CommitGraphRowProps {
  commit: GitLogCommit;
  layout: CommitGraphRowLayout;
  serverId: string;
  cwd: string;
  expanded: boolean;
  onToggleExpand: (hash: string) => void;
  onOpenFile?: (filePath: string) => void;
}

function CommitGraphRowInner({
  commit,
  layout,
  serverId,
  cwd,
  expanded,
  onToggleExpand,
  onOpenFile,
}: CommitGraphRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    onToggleExpand(commit.hash);
  }, [commit.hash, onToggleExpand]);

  const badges = useMemo(() => classifyRefs(commit.refs), [commit.refs]);
  const timeAgo = useMemo(() => formatTimeAgo(new Date(commit.authorDate)), [commit.authorDate]);
  const shortHash = commit.hash.slice(0, 7);
  const graphWidth = layout.laneCount * GRAPH_LANE_WIDTH;
  const rowStyle = useMemo(
    () => [styles.row, (isHovered || isNative || expanded) && styles.rowHovered],
    [isHovered, expanded],
  );
  // Lanes that keep running below this row (one per distinct outgoing lane).
  const continuingLanes = useMemo(() => {
    const byLane = new Map<number, ContinuingLane>();
    for (const edge of layout.outEdges) {
      if (!byLane.has(edge.toLane)) {
        byLane.set(edge.toLane, { lane: edge.toLane, colorIndex: edge.colorIndex });
      }
    }
    return [...byLane.values()];
  }, [layout.outEdges]);

  return (
    // Hover tracking lives on a plain View (docs/hover.md): pointer events are
    // web-only no-ops on native, where the press affordance is always visible.
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={commit.subject}
        accessibilityHint={shortHash}
        accessibilityState={EXPANDABLE_STATE[expanded ? "expanded" : "collapsed"]}
        onPress={handlePress}
        style={rowStyle}
        testID={`commit-row-${shortHash}`}
      >
        <ThemedCommitGraphSvg layout={layout} width={graphWidth} uniProps={laneColorsMapping} />
        <CommitRowSummary commit={commit} badges={badges} timeAgo={timeAgo} shortHash={shortHash} />
      </Pressable>
      {expanded ? (
        <Animated.View
          style={EXPANDED_ROW_STYLE}
          entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)}
        >
          <ThemedExpandedLaneGutter
            lanes={continuingLanes}
            width={graphWidth}
            uniProps={laneColorsMapping}
          />
          <View style={EXPANDED_CONTENT_STYLE}>
            <CommitExpandedDetails
              commit={commit}
              serverId={serverId}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function CommitRowSummary({
  commit,
  badges,
  timeAgo,
  shortHash,
}: {
  commit: GitLogCommit;
  badges: RefBadge[];
  timeAgo: string;
  shortHash: string;
}) {
  return (
    <View style={styles.details}>
      <View style={styles.subjectRow}>
        {badges.map((badge) => (
          <RefBadgePill key={`${badge.kind}-${badge.label}`} badge={badge} />
        ))}
        <Text style={styles.subject} numberOfLines={1}>
          {commit.subject}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <View style={styles.authorGroup}>
          <CommitAvatar name={commit.authorName} email={commit.authorEmail} />
          <Text style={styles.metaText} numberOfLines={1}>
            {commit.authorName} · {timeAgo}
          </Text>
        </View>
        <Text style={styles.hashText}>{shortHash}</Text>
      </View>
    </View>
  );
}

const EXPANDABLE_STATE = {
  expanded: { expanded: true },
  collapsed: { expanded: false },
} as const;

/** Expanded body under a commit row: full metadata plus the changed files. */
function CommitExpandedDetails({
  commit,
  serverId,
  cwd,
  onOpenFile,
}: {
  commit: GitLogCommit;
  serverId: string;
  cwd: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const handleCopyHash = useCallback(() => {
    // Show the short hash, copy the full one.
    void Clipboard.setStringAsync(commit.hash).then(() => toast.copied());
  }, [commit.hash, toast]);
  const fullDate = useMemo(() => new Date(commit.authorDate).toLocaleString(), [commit.authorDate]);

  return (
    <View style={styles.expandedContainer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.sourceControl.commit.copyHash")}
        onPress={handleCopyHash}
        style={styles.expandedHashRow}
        hitSlop={6}
      >
        <Text style={styles.expandedHash} numberOfLines={1}>
          {commit.hash.slice(0, 12)}
        </Text>
      </Pressable>
      <Text style={styles.expandedMeta} numberOfLines={1}>
        {commit.authorName}
        {commit.authorEmail ? ` <${commit.authorEmail}>` : ""} · {fullDate}
      </Text>
      {commit.body ? <CommitBodySection body={commit.body} /> : null}
      <CommitFilesList serverId={serverId} cwd={cwd} hash={commit.hash} onOpenFile={onOpenFile} />
    </View>
  );
}

/**
 * Commit message body, collapsed to a two-line preview by default; expanding
 * renders the full message as markdown.
 */
function CommitBodySection({ body }: { body: string }) {
  const { t } = useTranslation();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const handleToggle = useCallback(() => setBodyExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded: bodyExpanded }), [bodyExpanded]);

  return (
    <View style={styles.bodySection}>
      {bodyExpanded ? (
        <MarkdownRenderer text={body} compact />
      ) : (
        <Text style={styles.expandedBody} numberOfLines={2}>
          {body}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={handleToggle}
        style={styles.bodyToggle}
        hitSlop={6}
        testID="commit-body-toggle"
      >
        <Text style={styles.bodyToggleText}>
          {bodyExpanded
            ? t("workspace.sourceControl.commit.showLess")
            : t("workspace.sourceControl.commit.showMore")}
        </Text>
      </Pressable>
    </View>
  );
}

function badgeStyle(badge: RefBadge) {
  switch (badge.kind) {
    case "head":
      return styles.badgeHead;
    case "tag":
      return styles.badgeTag;
    case "remote":
      return styles.badgeRemote;
    default:
      return styles.badgeBranch;
  }
}

function RefBadgePill({ badge }: { badge: RefBadge }) {
  const containerStyle = useMemo(() => [styles.badge, badgeStyle(badge)], [badge]);
  const textStyle = useMemo(
    () => [styles.badgeText, badge.kind === "head" ? styles.badgeTextHead : null],
    [badge.kind],
  );
  return (
    <View style={containerStyle}>
      <Text style={textStyle} numberOfLines={1}>
        {badge.label}
      </Text>
    </View>
  );
}

export const CommitGraphRow = memo(CommitGraphRowInner);

// Static styles for the expanded Animated.View and the lane gutter — the
// gutter draws plain colored Views, no theme lookups needed at render time.
const EXPANDED_ROW_STYLE = { flexDirection: "row" } as const;
const EXPANDED_CONTENT_STYLE = { flex: 1, minWidth: 0 } as const;

const gutterStaticStyles = RNStyleSheet.create({
  container: {
    position: "relative",
    flexShrink: 0,
    marginLeft: 8,
  },
  svg: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
});

const styles = StyleSheet.create((theme) => ({
  rowContainer: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: COMMIT_ROW_HEIGHT,
    paddingRight: theme.spacing[3],
    paddingLeft: theme.spacing[2],
  },
  authorGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  expandedContainer: {
    // Matches the row summary's marginLeft so expanded text lines up with it.
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    gap: 2,
  },
  bodySection: {
    marginTop: 2,
    gap: 2,
  },
  bodyToggle: {
    alignSelf: "flex-start",
    minHeight: 20,
    justifyContent: "center",
  },
  bodyToggleText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
  },
  expandedHashRow: {
    alignSelf: "flex-start",
  },
  expandedHash: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  expandedMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  expandedBody: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  details: {
    flex: 1,
    minWidth: 0,
    marginLeft: theme.spacing[2],
    justifyContent: "center",
    gap: 2,
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  subject: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  metaText: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  hashText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  badge: {
    maxWidth: 140,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
  },
  badgeHead: {
    borderColor: theme.colors.accent,
  },
  badgeBranch: {
    borderColor: theme.colors.border,
  },
  badgeRemote: {
    borderColor: theme.colors.border,
    opacity: 0.8,
  },
  badgeTag: {
    borderColor: theme.colors.success,
  },
  badgeText: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
  },
  badgeTextHead: {
    color: theme.colors.accent,
  },
}));
