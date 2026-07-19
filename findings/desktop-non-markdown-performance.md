# Desktop non-Markdown performance findings

Date: 2026-07-19

## Accepted: history-independent draft attachment GC

Ordinary draft text updates previously scheduled attachment garbage collection. Each GC traversed
every cached session's stream head and tail to discover user-message image ids, even though typing
does not change attachment ownership.

The accepted policy schedules GC only when the set of draft image ids changes. Clear, lifecycle,
migration, hydration, and actual attachment changes retain their cleanup checkpoints.

- Evidence: `20260719_224102__image_reference_change_fast_path__984e79`
- Workload: 0/100/500 cached streams, 176 items each, 60 ordinary keys
- 500-stream result: 60 scans -> 0; 5,280,000 item visits -> 0
- Isolated policy p50/p95: 12.078/14.311ms -> 0.0017/0.0271ms

This is deliberately not described as an input-to-paint number. It isolates the removed synchronous
history-scaled discovery work; an end-to-end composer benchmark remains part of DRAFT-01.

## Deferred: active-only Agent timeline mounting

Unmounting all inactive Agent timelines has strong DOM and medium-history benefits, but did not pass
the frozen long-history gate.

- Evidence: retained `20260719_222752__retained_same_source__b2ee34`; active-only
  `20260719_222952__active_agent_only__c064f5`
- Same tracked patch hash in both runs
- 8 x 176 inactive DOM: 886 -> 0
- 8 x 176 post-GC heap: 147.3MiB -> 137.0MiB (-7.0%; gate was at least -15%)
- 8 x 176 body p50/p95: 84.8/149.9ms -> 92.4/170.2ms
- 8 x 176 React p95: 690.0ms -> 772.6ms

The product therefore keeps its retained three-entry LRU. The ablation can still be selected by the
benchmark override, but its scroll-state companion is not promoted. A later candidate should first
attribute the virtualized remount/React cost, then run an isolated real-Electron physical-footprint/
page-in measurement without touching port 6767.
