# Desktop performance plan and optimization ledger

This document is the source of truth for Paseo Desktop interaction-performance work. It records
measured baselines, optimization priority, experiment order, acceptance gates, and rejected
hypotheses. Individual benchmark artifacts remain under `experiments/` and `runs/`; this document
links the results and tracks what should happen next.

The plan follows benchmark-first, single-variable ablation:

```text
freeze workload -> record baseline -> change one main variable -> compare -> accept or reject
```

Do not restart or attach experiments to the production daemon on port `6767`. Desktop benchmarks
must use an isolated daemon, isolated state, and a non-production Metro/Electron instance.

## Priority and status

Priority describes user/data impact, not permission to bundle changes:

- **P0**: measured interaction blocker, unbounded growth, or work performed at typing/streaming
  frequency. Start or instrument now.
- **P1**: measured high cost with a larger lifecycle/virtualization change, or a high-probability
  issue whose benchmark still needs to be frozen.
- **P2**: bounded or lower-frequency cost, or a candidate without enough end-to-end evidence.

Status values:

- `accepted`: benchmarked, merged into this branch, and retained.
- `measuring`: benchmark/workload is being frozen; implementation must not start yet.
- `queued`: evidence and acceptance gate exist; ready for its ablation turn.
- `blocked`: a named dependency prevents a comparable experiment.
- `deferred`: deliberately later than a higher-impact or lower-risk experiment.
- `rejected`: the ablation did not move its target metric or violated a guardrail.

## Current frozen evidence

### Stored history and workspace switching

The authoritative reproducible workload is 1/4/8 heavy workspace tabs with 50/100/176 history
items. The production observation is more severe than the synthetic harness: one supplied Agent
switch took 4.49s before the body changed, and the renderer reached 3.2-3.3GB physical footprint
(3.7GB peak) after cycling eight heavy tabs.

| Desktop-web policy        | 8x176 body p50/p95 | Long-task p50/p95 | DOM / inactive DOM | Live heap |
| ------------------------- | -----------------: | ----------------: | -----------------: | --------: |
| 100 threshold / 50 recent |        151 / 280ms |       150 / 279ms |      7,595 / 4,404 |   220.7MB |
| 50 threshold / 20 recent  |         92 / 175ms |         0 / 152ms |        2,531 / 886 |   156.8MB |

The 50/20 policy is accepted. It reduced DOM, inactive DOM, live heap, and heavy-switch latency,
but React commits remain at 8/9 p50/p95 and inactive timelines are still retained under
`display:none`.

### Live assistant stream

The current workload sends exact 512-byte provider chunks every 1ms. The payload is one long plain
text paragraph, so these numbers measure the general React/Markdown path and **do not** exercise
syntax highlighting.

| Payload | Reducer p50/p95 | End-to-end p50/p95 | Commits p50/p95 | Long-task p50/p95 | Feedback p50/p95 |
| ------- | --------------: | -----------------: | --------------: | ----------------: | ---------------: |
| 64KiB   |     1.6 / 2.6ms |        358 / 369ms |         10 / 10 |       192 / 208ms |        89 / 95ms |
| 256KiB  |     3.0 / 3.1ms |        844 / 914ms |         20 / 22 |       188 / 203ms |        81 / 88ms |
| 1MiB    |    9.8 / 12.0ms |    2,769 / 3,422ms |         48 / 54 |   1,265 / 1,741ms |        80 / 89ms |

At 1MiB, the reducer is no longer the dominant cost. The current trace contains only 40/47 client
chunks and 2/3 chunks per app flush, while summed nested React/Markdown profiler duration is about
1.61s.

Detailed run IDs and methodology live in
[`experiments/2026-07-19_desktop_interaction/notes.md`](../experiments/2026-07-19_desktop_interaction/notes.md).

## Optimization ledger

The rank is the intended execution order after prerequisite measurement. Each accepted ablation
gets its own commit and before/after run; do not combine adjacent rows into one candidate.

| Rank | ID                  | Priority | Data-volume trigger                             | Candidate / one main variable                                                  | Status    |
| ---: | ------------------- | -------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | --------- |
|    0 | BENCH-MD-01         | P0       | 64KiB/256KiB/1MiB live messages                 | Freeze prose, open-fence, closed-fence, mixed-real-trace Markdown workloads    | measuring |
|    1 | MD-TAIL-01          | P0       | A growing final Markdown block                  | Render only the unstable live tail through a bounded plain/deferred path       | queued    |
|    2 | MD-CODE-01          | P0       | Long or unclosed streamed code fences           | Remove synchronous live-fence highlighting from React render                   | queued    |
|    3 | TAB-LIFE-01         | P0       | 4-8 retained heavy Agent tabs                   | Retain tab state, but mount only the active Agent timeline                     | deferred  |
|    4 | STREAM-BOUND-01     | P0       | Long-running Agents and many cached sessions    | Put measured bounds on stream tail/history cache ownership                     | measuring |
|    5 | DRAFT-01            | P0       | Every keystroke x all session streams           | Move draft serialization and attachment GC out of the keystroke path           | measuring |
|    6 | TURN-VIRT-01        | P1       | 100/176/500+ historical turns                   | Replace partial old/recent projection with measured turn-window virtualization | deferred  |
|    7 | SUBAGENT-01         | P1       | About 10 running subagents or large tool groups | Mount/hydrate selected detail only; keep bounded inline summaries              | measuring |
|    8 | DIFF-01             | P1       | Large multi-file diffs and large tool JSON      | Add visibility/expansion gates and explicit byte/line budgets                  | measuring |
|    9 | CHANGES-01          | P1       | Large repositories or cold git state            | Separate Changes RPC, daemon git, cache, and render latency                    | measuring |
|   10 | CSS-INPUT-01        | P1       | Main-thread load during hover/press             | Move ordinary Desktop-web visual feedback to CSS selectors                     | queued    |
|   11 | SPLIT-01            | P1       | Pointermove during pane resize                  | rAF-coalesce layout/terminal fit; persist once on pointerup                    | measuring |
|   12 | COMMAND-01          | P2       | Hundreds of Agents/workspaces                   | Bound or virtualize Command Center results and search measurement              | deferred  |
|   13 | IPC-BINARY-01       | P2       | High-throughput terminal/binary frames          | Measure and remove avoidable Electron base64 copies                            | deferred  |
|   14 | SERVER-SERIALIZE-01 | P2       | Multiple connected clients                      | Reuse equivalent serialized session payloads                                   | deferred  |

### Accepted foundation

| ID                | Change                                                            | Evidence                                                                | Result                                                                                                        |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| STREAM-REDUCE-01  | Coalesce consecutive assistant chunks in one scheduler flush      | 64KiB/256KiB/1MiB reducer benchmark plus real chunks/flush distribution | Accepted; useful for streaming CPU/GC, but real workload proves it is not the remaining end-to-end bottleneck |
| TURN-THRESHOLD-01 | Lower Desktop-web partial virtualization threshold from 100 to 50 | Full-history 1/4/8-tab matrix                                           | Accepted                                                                                                      |
| TURN-RECENT-01    | Reduce mounted recent Desktop-web window from 50 to 20            | Full-history 1/4/8-tab matrix                                           | Accepted; 8x176 inactive DOM 4,404 -> 886 and live heap 220.7MB -> 156.8MB relative to the original baseline  |
| DRAFT-GC-01       | Schedule attachment GC only when draft image references change    | 0/100/500 streams x 176 items x 60 ordinary keystrokes                  | Accepted; 500-stream item visits 5,280,000 -> 0, isolated policy p95 14.311ms -> 0.027ms                      |

## P0 experiment cards

### BENCH-MD-01 — freeze representative Markdown workloads

**Why:** the existing all-`x` payload cannot attribute cost to Markdown structure or highlighting.

Add fixed, versioned payloads for:

1. one unbroken plain paragraph;
2. many completed prose paragraphs;
3. one open code fence;
4. completed fenced code blocks;
5. a sanitized mixed trace containing prose, lists, tables, links, code, and tool transitions.

Record Markdown parse time, highlight time, React duration/commits, end-to-end p50/p95, long-task
time, feedback delay, DOM/AX nodes, and final rendered-content equivalence. Preserve payload hashes in
the run manifest.

**Exit gate:** five deterministic workload slices run at all three sizes, with five fresh Agents per
size, and two repeated baseline runs differ by no more than 15% on end-to-end p95 for the 256KiB and
1MiB slices.

### MD-TAIL-01 — bounded live-tail rendering

**Hypothesis:** completed Markdown blocks are already memoized; reparsing and remounting the growing
final block accounts for most of the remaining 1MiB React/Markdown cost.

Candidate behavior:

- pass an explicit `isStreaming` signal to the live assistant message;
- keep completed blocks on the existing full renderer;
- render the unstable final block as plain text or on an 80-120ms parse budget;
- promote the tail at a safe block boundary and always do a final lossless render on completion;
- preserve link/image safety and stable message/provider/epoch semantics.

**Promotion gate on the existing plain 1MiB slice:** end-to-end p95 <= 2.2s, total long-task p95 <=
900ms, feedback p95 <= 65ms, and no 64KiB/256KiB end-to-end p95 regression above 10%. Final settled
Markdown text and link targets must match the baseline renderer.

### MD-CODE-01 — deferred streamed-code highlighting

**Hypothesis:** synchronous `highlightToKeyedLines` during React render makes an open code block more
expensive on every delta.

First ablation only:

- render an unclosed live fence as raw monospace text;
- highlight after the fence closes or the message completes;
- do not add a Worker or replace the highlighter in the same ablation.

Second ablation, only if still needed: defer completed offscreen code/Mermaid blocks until near the
viewport. Desktop web may use `IntersectionObserver`; native must use list viewability rather than a
DOM API.

**Promotion gate:** no highlight task above 50ms while the fence is open, open-fence end-to-end p95
improves by at least 35%, feedback p95 improves by at least 25%, and completed code produces the same
language class, visible text, copy text, and final highlighted tokens as baseline.

### TAB-LIFE-01 — active Agent timeline ownership

**Hypothesis:** retained `display:none` Agent timelines cause multi-gigabyte footprint, page-in on
switch, and a window where the new title is paired with the old body.

First ablation:

- retain lightweight tab metadata, query state, draft, and a per-Agent scroll snapshot;
- unmount inactive Agent timeline DOM;
- key the active frame/list by Agent id;
- show a neutral loading/skeleton state until the new body has mounted and become visible;
- do not change the existing timeline projection window in this ablation.

**Promotion gate:** zero new-title/old-body frames in every 1/4/8 x 50/100/176 switch case;
`inactiveTimelineDomNodes` equals zero; 8x176 switch p95 remains <= 200ms; post-GC live heap improves
by at least 15% from the immediate 50/20 baseline. A separate isolated Electron run must show lower
physical footprint and page-in without touching port 6767.

Guardrails: running Agents continue receiving data, terminal state survives switching, newest and
oldest scroll positions restore within one row, subagent tracker state survives, and mobile layout
behavior is unchanged.

**2026-07-19 decision:** deferred, not promoted. In the same-source 8 x 176 comparison, active-only
removed 886 inactive timeline DOM nodes and reduced post-GC heap 147.3MiB -> 137.0MiB (7.0%), but
body-consistency p95 regressed 149.9ms -> 170.2ms and React p95 regressed 690.0ms -> 772.6ms. It
missed the frozen 15% heap gate. The product keeps the retained LRU default; run IDs and the
medium-history wins are recorded in `experiments/2026-07-19_desktop_tab_lifecycle/notes.md`.

### STREAM-BOUND-01 — bounded long-session ownership

**Why:** `agentStreamTail` and selected React Query replicas have effectively unbounded lifetimes.
Changing global `gcTime` blindly is unsafe because replica semantics may depend on it.

Before implementation, measure retained bytes by query key and stream component at 50/100/176/500
turns, after cycling 1/4/8 tabs and after forced GC. Then bound one owner at a time: stream tail,
historical pages, or a specific large query class.

**Promotion gate:** 500-turn post-GC live heap grows no more than 25% over the 176-turn case after
the same visible window is restored; no gap, epoch, provider, messageId, pagination, or reconnect
regression; revisiting evicted history shows an explicit load state and restores the correct anchor.

### DRAFT-01 — remove history-scaled work from typing

**Known state:** storage writes are already throttled by 200ms. However every text update still
updates persisted draft state and schedules attachment GC; GC scans session head/tail streams.

Freeze a typing workload with 0/100/500 cached sessions, 60 keystrokes, and no attachment mutation.
Count serialization, storage writes, stream items scanned, main-thread time, and input feedback.

First ablation: trigger attachment GC only on attachment mutation or an idle/lifecycle checkpoint.
Second ablation: debounce/checkpoint the persisted draft representation without delaying the local
composer state.

**Promotion gate:** zero stream-item scans per ordinary keystroke; at most one persistence write per
500ms burst; typing p95 <= 16.7ms in the 500-session slice; attachment deletion and crash/relaunch
draft recovery remain correct.

**DRAFT-GC-01 accepted:** ordinary text edits now schedule no attachment GC. At 500 cached streams x
176 items x 60 keys, reference-discovery visits fell 5,280,000 -> 0 and isolated policy p95 fell
14.311ms -> 0.027ms. Image additions/removals and lifecycle/startup checkpoints still schedule GC.
The separate persisted-draft write/coalescing gate remains open under DRAFT-01.

## P1 experiment cards

### TURN-VIRT-01 — measured turn-window virtualization

This follows, rather than bundles with, TAB-LIFE-01. Use stable turn keys, measured/estimated heights,
binary-search range selection, small overscan, and distance-from-bottom scroll restoration. The
mounted turn count should depend on viewport size, not total history length.

**Promotion gate:** active timeline DOM at 500 turns stays within 15% of the 176-turn case; 8x500
switch p95 <= 200ms; oldest/newest navigation and scroll restoration remain correct; live-stream,
terminal, gap, and subagent rows do not disappear while active.

### SUBAGENT-01 and DIFF-01 — detail on demand

Create separate benchmarks before changing rendering:

- ten running subagents, collapsed/expanded/selected;
- tool result JSON at 64KiB/256KiB/1MiB;
- diffs at 3/25/100 files and 500/2,000/5,000 changed lines.

Candidate policies are bounded inline summaries, selected-child-only hydration, maximum inline
files/lines, `Show more`, and offscreen detail deferral. Do not introduce all policies in one
variant.

Initial gates: ten-subagent renderer CPU <= 20%, panel expand p95 <= 400ms, shell detail expand p95
<= 300ms, and no unselected child mounts a full timeline. Diff/tool gates are frozen with their
baseline release before implementation.

### CHANGES-01 — Explorer Changes latency decomposition

The observed failure is more than two minutes before `No uncommitted changes`. Rendering alone is
not an adequate diagnosis. Instrument four timestamps:

1. user selection;
2. request dispatch;
3. daemon git result;
4. renderer commit.

Also record repository file count, status entry count, cache state, cancellation, and competing git
operations. Only after this split should the next ablation target RPC scheduling, git execution,
cache invalidation, or rendering.

**Promotion gate:** clean-repository cold p95 <= 1s and warm p95 <= 250ms on the frozen large-repo
fixture; stale or canceled requests cannot replace a newer result.

### CSS-INPUT-01 — Desktop-web CSS interaction fast path

Start with one high-frequency component family, such as icon buttons or timeline copy controls.
Move ordinary visual-only hover/active state to CSS `:hover`, `:active`, and `:focus-visible`; keep
native Pressable semantics and accessibility unchanged. Hover that reveals or coordinates other
content must continue to follow [`hover.md`](hover.md).

**Promotion gate:** hover-only interaction causes zero React commits for the migrated visual state,
appears by the next rendered frame under the 256KiB stream workload, and passes keyboard focus,
screen-reader labeling, touch, and compact-layout checks.

## Deferred lower-priority candidates

- **SPLIT-01:** measure pointermove, workspace persistence, layout, and terminal fit separately;
  then rAF-coalesce only live geometry and persist on pointerup.
- **COMMAND-01:** freeze 100/500/1,000 result workloads before choosing result caps or
  virtualization compatible with drag/reorder behavior.
- **IPC-BINARY-01:** compare base64 and transferable/binary Electron paths with terminal ordering,
  snapshot, and backpressure invariants intact. Do not disturb the existing terminal pipeline
  without reading [`terminal-performance.md`](terminal-performance.md).
- **SERVER-SERIALIZE-01:** measure daemon serialization self-time at 1/2/4 clients before caching
  payloads; preserve per-client capability and authorization differences.

## Regression matrix

Every promoted P0/P1 change runs the smallest relevant targeted tests plus typecheck and lint. Never
run the full local test suite.

| Area            | Required semantics                                                               |
| --------------- | -------------------------------------------------------------------------------- |
| Stream          | epoch/provider/messageId/gap ordering, final content, reconnect, live completion |
| Timeline        | newest/oldest navigation, scroll anchor, active and scrolled-away streaming      |
| Tabs            | running Agent continuity, re-entry, title/body identity, draft state             |
| Terminal        | state/output survival, display refit, input latency and ordering                 |
| Subagents/tools | tracker state, selected detail, expansion, copy/export                           |
| Cross-platform  | Desktop-web gates do not alter iOS/Android behavior; DOM APIs stay web-only      |
| Accessibility   | keyboard focus, visible controls, labels, AX node count, reduced motion          |

## Experiment and ledger update protocol

For each row moved to `measuring` or `queued`:

1. Freeze the benchmark payload/config and record its version or hash.
2. Record a reproducible baseline on the current branch.
3. Make one primary implementation change.
4. Save before/after metrics, profiler samples, environment, and git SHA under `runs/`.
5. Inspect regressions and representative bad cases, not only aggregate p95.
6. Mark the ledger row `accepted`, `rejected`, or `blocked`, with the run IDs and reason.
7. If accepted, update the current baseline table; never silently compare runs from different
   benchmark versions.

The default next sequence is:

```text
BENCH-MD-01 -> MD-TAIL-01 -> MD-CODE-01 -> TAB-LIFE-01
            -> STREAM-BOUND-01 -> DRAFT-01 -> TURN-VIRT-01
```

Reorder only when a new frozen benchmark shows a larger impact class or a correctness dependency
requires it.

## Confirmed non-priorities

Keep these findings to avoid repeating unproductive investigations:

- `session-context.tsx` does not provide a changing context value that cascades through the tree.
- reconnect does not restore every Agent stream; it restores focused Agent state and metadata.
- voice state is throttled and subscription-isolated.
- model selection is already virtualized.
- React Compiler, paragraph memoization, and fine-grained Zustand selectors already exist; adding
  generic memo wrappers is not an optimization plan.
- Codex Desktop's recovered remote reducer still concatenates deltas; it does not replace or
  invalidate Paseo's accepted scheduler-flush reducer coalescing work.
