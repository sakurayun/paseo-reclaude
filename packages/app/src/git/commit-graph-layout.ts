import type { GitLogCommit } from "@getpaseo/protocol/messages";

/**
 * Lanes beyond this column collapse onto the last visible one so pathological
 * histories (octopus merges, many live branches) keep a bounded graph width.
 */
export const MAX_GRAPH_LANES = 8;

export interface CommitGraphEdge {
  /** Lane the segment starts in (top half of the row connects upward). */
  fromLane: number;
  /** Lane the segment ends in (bottom half of the row connects downward). */
  toLane: number;
  colorIndex: number;
  /** Whether the segment touches this row's commit node or just passes through. */
  kind: "node" | "pass";
}

export interface CommitGraphRowLayout {
  hash: string;
  lane: number;
  colorIndex: number;
  /** Segments in the top half of the row, connecting to the previous row. */
  inEdges: CommitGraphEdge[];
  /** Segments in the bottom half of the row, connecting to the next row. */
  outEdges: CommitGraphEdge[];
  laneCount: number;
}

interface ActiveLane {
  /** Commit hash this lane is waiting to reach, or null when free. */
  expected: string | null;
  colorIndex: number;
}

function clampLane(lane: number): number {
  return Math.min(lane, MAX_GRAPH_LANES - 1);
}

/**
 * Assigns swim lanes to a topologically ordered commit list (children always
 * before parents — `git log --topo-order` guarantees this). Classic
 * first-parent-keeps-the-lane algorithm: each commit claims the leftmost lane
 * expecting it, releases other lanes merging into it, then reserves lanes for
 * its parents.
 */
interface LaneRef {
  lane: number;
  colorIndex: number;
}

function claimCommitLane(
  lanes: ActiveLane[],
  matchingLanes: number[],
  allocateColor: () => number,
): LaneRef {
  if (matchingLanes.length > 0) {
    const lane = matchingLanes[0];
    return { lane, colorIndex: lanes[lane].colorIndex };
  }
  // Branch tip never referenced above: claim the leftmost free lane.
  let lane = lanes.findIndex((entry) => entry.expected === null);
  if (lane === -1) {
    lane = lanes.length;
    lanes.push({ expected: null, colorIndex: 0 });
  }
  const colorIndex = allocateColor();
  lanes[lane] = { expected: null, colorIndex };
  return { lane, colorIndex };
}

/** Top half: lanes expecting this commit converge on its node; others pass through. */
function buildInEdges(lanes: readonly ActiveLane[], hash: string, lane: number): CommitGraphEdge[] {
  const inEdges: CommitGraphEdge[] = [];
  for (let i = 0; i < lanes.length; i += 1) {
    const entry = lanes[i];
    if (entry.expected === hash) {
      inEdges.push({
        fromLane: clampLane(i),
        toLane: clampLane(lane),
        colorIndex: entry.colorIndex,
        kind: "node",
      });
    } else if (entry.expected !== null) {
      inEdges.push({
        fromLane: clampLane(i),
        toLane: clampLane(i),
        colorIndex: entry.colorIndex,
        kind: "pass",
      });
    }
  }
  return inEdges;
}

interface ParentLaneRef extends LaneRef {
  /**
   * True when the lane already carried a line from above (a previous merge
   * also targets this parent). The merge edge joins that line rather than
   * starting a new one, so the lane keeps its pass-through segment.
   */
  joinsExistingLine: boolean;
}

/** First parent continues in the commit's lane; other parents fork to new lanes. */
function assignParentLanes(
  lanes: ActiveLane[],
  commit: GitLogCommit,
  claimed: LaneRef,
  allocateColor: () => number,
): ParentLaneRef[] {
  // Octopus merges can repeat a parent; processing it twice would emit
  // duplicate edges for the same lane.
  const uniqueParents = [...new Set(commit.parents)];
  const [firstParent, ...restParents] = uniqueParents;
  lanes[claimed.lane] = { expected: firstParent ?? null, colorIndex: claimed.colorIndex };

  const parentLanes: ParentLaneRef[] = [];
  if (firstParent) {
    parentLanes.push({ ...claimed, joinsExistingLine: false });
  }
  for (const parent of restParents) {
    // Reuse a lane already waiting on this parent so histories converge
    // instead of spawning duplicate columns.
    const existingLane = lanes.findIndex((entry) => entry.expected === parent);
    if (existingLane !== -1) {
      parentLanes.push({
        lane: existingLane,
        colorIndex: lanes[existingLane].colorIndex,
        joinsExistingLine: true,
      });
      continue;
    }
    let parentLane = lanes.findIndex(
      (entry, index) => entry.expected === null && index !== claimed.lane,
    );
    if (parentLane === -1) {
      parentLane = lanes.length;
      lanes.push({ expected: null, colorIndex: 0 });
    }
    const parentColor = allocateColor();
    lanes[parentLane] = { expected: parent, colorIndex: parentColor };
    parentLanes.push({ lane: parentLane, colorIndex: parentColor, joinsExistingLine: false });
  }
  return parentLanes;
}

/** Bottom half: node fans out to each parent lane; untouched occupied lanes pass through. */
function buildOutEdges(
  lanes: readonly ActiveLane[],
  lane: number,
  parentLanes: readonly ParentLaneRef[],
): CommitGraphEdge[] {
  const outEdges: CommitGraphEdge[] = [];
  for (const parentRef of parentLanes) {
    outEdges.push({
      fromLane: clampLane(lane),
      toLane: clampLane(parentRef.lane),
      colorIndex: parentRef.colorIndex,
      kind: "node",
    });
  }
  for (let i = 0; i < lanes.length; i += 1) {
    const entry = lanes[i];
    if (entry.expected === null) continue;
    const parentRef = parentLanes.find((ref) => ref.lane === i);
    // A lane that already carried a line keeps its pass-through segment even
    // when this commit merges into it — suppressing it would cut the line
    // mid-row. Freshly assigned parent lanes start at the node instead.
    if (parentRef && !parentRef.joinsExistingLine) continue;
    outEdges.push({
      fromLane: clampLane(i),
      toLane: clampLane(i),
      colorIndex: entry.colorIndex,
      kind: "pass",
    });
  }
  return outEdges;
}

/**
 * Clamping can fold several lanes onto the last visible column, producing
 * geometrically identical segments. Collapse those: the renderer keys SVG
 * paths by `fromLane-toLane-kind`, so duplicates would collide as React keys
 * (dropping paths on re-render) and overdraw the same pixels.
 */
function dedupeEdges(edges: readonly CommitGraphEdge[]): CommitGraphEdge[] {
  const seen = new Set<string>();
  const result: CommitGraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.fromLane}:${edge.toLane}:${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

export function layoutCommitGraph(commits: readonly GitLogCommit[]): CommitGraphRowLayout[] {
  const lanes: ActiveLane[] = [];
  let nextColorIndex = 0;
  const rows: CommitGraphRowLayout[] = [];

  const allocateColor = (): number => {
    const color = nextColorIndex;
    nextColorIndex += 1;
    return color;
  };

  for (const commit of commits) {
    const matchingLanes: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i].expected === commit.hash) {
        matchingLanes.push(i);
      }
    }

    const claimed = claimCommitLane(lanes, matchingLanes, allocateColor);
    const inEdges = buildInEdges(lanes, commit.hash, claimed.lane);

    // Release every lane that merged into this commit (keep the claimed one).
    for (const mergedLane of matchingLanes) {
      if (mergedLane !== claimed.lane) {
        lanes[mergedLane] = { expected: null, colorIndex: lanes[mergedLane].colorIndex };
      }
    }

    const parentLanes = assignParentLanes(lanes, commit, claimed, allocateColor);
    const outEdges = buildOutEdges(lanes, claimed.lane, parentLanes);

    rows.push({
      hash: commit.hash,
      lane: clampLane(claimed.lane),
      colorIndex: claimed.colorIndex,
      inEdges: dedupeEdges(inEdges),
      outEdges: dedupeEdges(outEdges),
      laneCount: 0,
    });
  }

  // Width of the widest row, so all rows render a consistent graph gutter.
  let maxLane = 0;
  for (const row of rows) {
    for (const edge of [...row.inEdges, ...row.outEdges]) {
      maxLane = Math.max(maxLane, edge.fromLane, edge.toLane);
    }
    maxLane = Math.max(maxLane, row.lane);
  }
  const laneCount = Math.min(MAX_GRAPH_LANES, maxLane + 1);
  for (const row of rows) {
    row.laneCount = laneCount;
  }

  return rows;
}
