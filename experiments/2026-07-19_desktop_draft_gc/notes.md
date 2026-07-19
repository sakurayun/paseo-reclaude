# Notes: desktop_draft_gc

- Persistence storage already coalesces writes to one checkpoint per 200ms; this experiment changes
  only attachment-GC scheduling.
- The benchmark reports both old always-scan and candidate image-reference policies over the same
  in-memory workload to eliminate machine/run drift.
- Lifecycle, migration, clear, and actual image-reference changes continue to schedule GC.

## Accepted result

Run `20260719_224102__image_reference_change_fast_path__984e79`:

| Cached streams | Workload | Always-scan p50/p95 | Candidate p50/p95 |    Item visits |
| -------------: | -------: | ------------------: | ----------------: | -------------: |
|              0 |  60 keys |   0.0036 / 0.0041ms | 0.0027 / 0.0031ms |         0 -> 0 |
|      100 x 176 |  60 keys |     2.285 / 2.343ms | 0.0017 / 0.0029ms | 1,056,000 -> 0 |
|      500 x 176 |  60 keys |   12.078 / 14.311ms | 0.0017 / 0.0271ms | 5,280,000 -> 0 |

Ordinary text changes now skip GC scheduling entirely. The benchmark's duration covers the isolated
reference-discovery policy, not browser input-to-paint, so the stable acceptance signal is the
history-independent zero scans/item visits. Persistence remains a separate DRAFT-01 ablation.
