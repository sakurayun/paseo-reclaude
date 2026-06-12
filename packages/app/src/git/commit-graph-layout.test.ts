import { describe, expect, it } from "vitest";
import type { GitLogCommit } from "@getpaseo/protocol/messages";
import {
  type CommitGraphRowLayout,
  layoutCommitGraph,
  MAX_GRAPH_LANES,
} from "./commit-graph-layout";

function commit(hash: string, parents: string[], subject = hash): GitLogCommit {
  return {
    hash,
    parents,
    subject,
    body: "",
    authorName: "Test",
    authorEmail: "test@example.com",
    authorDate: "2026-06-12T00:00:00+00:00",
    refs: [],
  };
}

/** The clamp column, where folded lanes legitimately share a position. */
const CLAMP_LANE = MAX_GRAPH_LANES - 1;

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Continuity invariants — any violation renders as a visually broken line:
 *
 * 1. Between adjacent rows, the set of columns (and colors, below the clamp
 *    column) where row i's bottom half ends must equal the set where row
 *    i+1's top half starts. At the clamp column several folded lanes share
 *    one position, so only positional continuity is required there.
 * 2. Within a row, a "pass" segment in the top half stops at the row middle;
 *    a matching "pass" segment must continue it through the bottom half
 *    (and vice versa), otherwise the line breaks mid-row.
 */
function assertContinuity(rows: readonly CommitGraphRowLayout[]): void {
  for (let i = 0; i + 1 < rows.length; i += 1) {
    const out = rows[i].outEdges;
    const inn = rows[i + 1].inEdges;
    expect(distinct(inn.map((edge) => `${edge.fromLane}`))).toEqual(
      distinct(out.map((edge) => `${edge.toLane}`)),
    );
    const outPairs = out
      .filter((edge) => edge.toLane < CLAMP_LANE)
      .map((edge) => `${edge.toLane}:${edge.colorIndex}`);
    const inPairs = inn
      .filter((edge) => edge.fromLane < CLAMP_LANE)
      .map((edge) => `${edge.fromLane}:${edge.colorIndex}`);
    expect(distinct(inPairs)).toEqual(distinct(outPairs));
  }
  for (const row of rows) {
    const passIn = row.inEdges
      .filter((edge) => edge.kind === "pass")
      .map((edge) => `${edge.toLane}:${edge.colorIndex}`);
    const passOut = row.outEdges
      .filter((edge) => edge.kind === "pass")
      .map((edge) => `${edge.fromLane}:${edge.colorIndex}`);
    expect(distinct(passOut)).toEqual(distinct(passIn));
  }
}

/**
 * Anchoring invariants: every commit referenced by a child must receive at
 * least one "node" in-edge landing on its lane, and every commit with a
 * parent must emit at least one "node" out-edge leaving its lane.
 */
function assertNodeAnchors(
  commits: readonly GitLogCommit[],
  rows: readonly CommitGraphRowLayout[],
): void {
  const referenced = new Set(commits.flatMap((entry) => entry.parents));
  rows.forEach((row, index) => {
    const entry = commits[index];
    if (referenced.has(entry.hash)) {
      expect(row.inEdges.some((edge) => edge.kind === "node" && edge.toLane === row.lane)).toBe(
        true,
      );
    }
    if (entry.parents.length > 0) {
      expect(row.outEdges.some((edge) => edge.kind === "node" && edge.fromLane === row.lane)).toBe(
        true,
      );
    }
  });
}

/**
 * The renderer keys SVG paths by `fromLane-toLane-kind` per half-row, so the
 * layout must never emit two edges with identical geometry — duplicate React
 * keys drop paths on re-render.
 */
function assertUniqueEdgeKeys(rows: readonly CommitGraphRowLayout[]): void {
  for (const row of rows) {
    for (const edges of [row.inEdges, row.outEdges]) {
      const keys = edges.map((edge) => `${edge.fromLane}-${edge.toLane}-${edge.kind}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  }
}

function assertInvariants(commits: readonly GitLogCommit[]): CommitGraphRowLayout[] {
  const rows = layoutCommitGraph(commits);
  assertContinuity(rows);
  assertNodeAnchors(commits, rows);
  assertUniqueEdgeKeys(rows);
  return rows;
}

/** Fan of unrelated branch tips t0..t(count-1); t0 may point at a different parent. */
function fanOfTips(count: number, parent: string, firstParent = parent): GitLogCommit[] {
  return Array.from({ length: count }, (_, i) => commit(`t${i}`, [i === 0 ? firstParent : parent]));
}

/** Deterministic PRNG (mulberry32) so random-DAG cases are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random DAG in topological order: commit i may only have parents with a
 * larger index, exactly how `git log --topo-order` lists children first.
 */
function randomCommits(seed: number, count: number): GitLogCommit[] {
  const rand = mulberry32(seed);
  const commits: GitLogCommit[] = [];
  for (let i = 0; i < count; i += 1) {
    const candidates = count - i - 1;
    let parentCount = 0;
    if (candidates > 0) {
      const roll = rand();
      if (roll < 0.7) parentCount = 1;
      else if (roll < 0.92) parentCount = 2;
      else if (roll < 0.99) parentCount = 3;
      parentCount = Math.min(parentCount, candidates);
    }
    const parents = new Set<string>();
    while (parents.size < parentCount) {
      parents.add(`c${i + 1 + Math.floor(rand() * candidates)}`);
    }
    commits.push(commit(`c${i}`, [...parents]));
  }
  return commits;
}

describe("layoutCommitGraph", () => {
  it("returns no rows for no commits", () => {
    expect(layoutCommitGraph([])).toEqual([]);
  });

  it("keeps a linear history in a single lane", () => {
    const rows = layoutCommitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.every((row) => row.laneCount === 1)).toBe(true);
    expect(rows[0].inEdges).toEqual([]);
    expect(rows[0].outEdges).toEqual([{ fromLane: 0, toLane: 0, colorIndex: 0, kind: "node" }]);
    // Root commit has no parents, so nothing leaves the last row.
    expect(rows[2].outEdges).toEqual([]);
  });

  it("forks a merge commit's second parent into a new lane and joins it back", () => {
    // m -> [b, f]; b -> a; f -> a; a root.   (feature branch merged into main)
    const rows = layoutCommitGraph([
      commit("m", ["b", "f"]),
      commit("b", ["a"]),
      commit("f", ["a"]),
      commit("a", []),
    ]);

    const [merge, main, feature, root] = rows;
    expect(merge.lane).toBe(0);
    expect(main.lane).toBe(0);
    expect(feature.lane).toBe(1);
    expect(root.lane).toBe(0);
    expect(rows[0].laneCount).toBe(2);

    // Merge row fans out to both parent lanes.
    expect(merge.outEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromLane: 0, toLane: 0, kind: "node" }),
        expect.objectContaining({ fromLane: 0, toLane: 1, kind: "node" }),
      ]),
    );
    // While rendering "b", the feature lane passes through.
    expect(main.inEdges).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromLane: 1, toLane: 1, kind: "pass" })]),
    );
    // Root receives both lanes converging onto its node.
    expect(root.inEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromLane: 0, toLane: 0, kind: "node" }),
        expect.objectContaining({ fromLane: 1, toLane: 0, kind: "node" }),
      ]),
    );
  });

  it("frees a lane after its branch merges so later branches reuse it", () => {
    // m2 merges g; m1 merges f; both feature branches should reuse lane 1.
    const rows = layoutCommitGraph([
      commit("m2", ["m1", "g"]),
      commit("g", ["m1"]),
      commit("m1", ["b", "f"]),
      commit("f", ["b"]),
      commit("b", []),
    ]);

    const byHash = Object.fromEntries(rows.map((row) => [row.hash, row]));
    expect(byHash.g.lane).toBe(1);
    expect(byHash.f.lane).toBe(1);
    expect(rows[0].laneCount).toBe(2);
  });

  it("gives independent branch tips separate lanes and colors", () => {
    // Two unrelated tips pointing at the same root (e.g. local + detached work).
    const rows = layoutCommitGraph([commit("t1", ["a"]), commit("t2", ["a"]), commit("a", [])]);

    const [tip1, tip2, root] = rows;
    expect(tip1.lane).toBe(0);
    expect(tip2.lane).toBe(1);
    expect(tip1.colorIndex).not.toBe(tip2.colorIndex);
    // Both lanes converge on the shared root.
    expect(root.lane).toBe(0);
    expect(root.inEdges).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromLane: 1, toLane: 0, kind: "node" })]),
    );
  });

  it("clamps lanes beyond the cap onto the last visible column", () => {
    // An octopus-style fan of tips far wider than the cap.
    const tipCount = MAX_GRAPH_LANES + 4;
    const tips = Array.from({ length: tipCount }, (_, i) => commit(`t${i}`, ["root"]));
    const rows = layoutCommitGraph([...tips, commit("root", [])]);

    for (const row of rows) {
      expect(row.lane).toBeLessThan(MAX_GRAPH_LANES);
      for (const edge of [...row.inEdges, ...row.outEdges]) {
        expect(edge.fromLane).toBeLessThan(MAX_GRAPH_LANES);
        expect(edge.toLane).toBeLessThan(MAX_GRAPH_LANES);
      }
      expect(row.laneCount).toBeLessThanOrEqual(MAX_GRAPH_LANES);
    }
  });

  describe("continuity invariants", () => {
    it("holds for a linear history", () => {
      assertInvariants([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    });

    it("holds for a single merge", () => {
      assertInvariants([
        commit("m", ["b", "f"]),
        commit("b", ["a"]),
        commit("f", ["a"]),
        commit("a", []),
      ]);
    });

    it("holds for consecutive merges", () => {
      assertInvariants([
        commit("m2", ["m1", "g"]),
        commit("g", ["m1"]),
        commit("m1", ["b", "f"]),
        commit("f", ["b"]),
        commit("b", []),
      ]);
    });

    it("holds when a branch forks off a merge commit and merges right back", () => {
      assertInvariants([
        commit("m2", ["m1", "f"]),
        commit("f", ["m1"]),
        commit("m1", ["b", "g"]),
        commit("g", ["a"]),
        commit("b", ["a"]),
        commit("a", []),
      ]);
    });

    it("holds when two branches share the same parent", () => {
      assertInvariants([
        commit("t1", ["a"]),
        commit("t2", ["a"]),
        commit("a", ["r"]),
        commit("r", []),
      ]);
    });

    it("keeps an existing lane continuous when a merge joins it (second parent reuse)", () => {
      // Both merges target the same second parent "a": the second merge "m"
      // joins the lane that is already waiting on "a" — the lane's vertical
      // line must keep running through the merge row.
      assertInvariants([
        commit("e", ["x", "a"]),
        commit("m", ["y", "a"]),
        commit("x", ["a"]),
        commit("y", ["a"]),
        commit("a", []),
      ]);
    });

    it("holds for an octopus merge with three parents", () => {
      assertInvariants([
        commit("o", ["p1", "p2", "p3"]),
        commit("p1", ["a"]),
        commit("p2", ["a"]),
        commit("p3", ["a"]),
        commit("a", []),
      ]);
    });

    it("holds for histories wider than the lane cap", () => {
      const tips = fanOfTips(MAX_GRAPH_LANES + 4, "root");
      assertInvariants([...tips, commit("root", [])]);
    });

    it("holds for merges landing past the clamp column", () => {
      // Tips t0..t9 occupy lanes past the cap; a merge between two clamped
      // branches must stay positionally continuous on the clamp column.
      const tips = fanOfTips(MAX_GRAPH_LANES + 2, "root", "m");
      assertInvariants([
        ...tips,
        commit("m", ["b", "root"]),
        commit("b", ["root"]),
        commit("root", []),
      ]);
    });

    it("holds for randomized DAGs", () => {
      for (let seed = 1; seed <= 25; seed += 1) {
        assertInvariants(randomCommits(seed, 32));
      }
    });
  });
});
