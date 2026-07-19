# Finding: desktop_markdown_performance

Benchmark: `desktop_markdown_rendering@v4`

Scorer: `desktop_markdown_metrics_v4`

## Current decisions

- `BENCH-MD-01`: v4 released. Representative payloads, feedback scoring, and canonical expanded
  render hashes are frozen.
- `MD-TAIL-01` first candidate: rejected. It cut one MiB Long Task p95 by 52%, but did not meet
  the end-to-end/feedback/frame-gap promotion gate.
- `MD-CODE-01` incomplete-fence candidate: rejected as a standalone change. It cut open-fence
  end-to-end p95 by 25%, Long Task p95 by 33%, and highlight calls by 50%, but feedback p95
  regressed 8% because final highlighting still mounted 29k DOM / 58k non-ignored AX nodes.
- The failed incomplete-fence candidate promoted bounded code rendering to P0: tokenization is a
  secondary cost; unbounded token/span mounting and accessibility-tree construction are dominant.
- `MD-CODE-02` bounded token tree: accepted. Rendering code above 16KiB as complete plain
  monospace text cut 64KiB feedback p95 95.6%, end-to-end p95 80.6%, DOM 99.96%, AX 94.5%,
  and post-GC heap 46.2%; Long Task fell from 862ms to zero and final rendered text was identical.
- Long-message block virtualization is also promoted to P0: 256KiB mixed Markdown mounts 111k DOM
  / 133k non-ignored AX nodes, retains 2.37GB after GC, and blocks feedback for 5.84s p95.
- CSS `content-visibility:auto` is rejected: run four could not detach the archived workspace tab
  within 30 seconds. Long-message work must explicitly bound mounted blocks and preserve lifecycle
  behavior instead of delegating visibility to browser layout containment.
- `MD-BLOCK-02` bounded promotion + mount window: accepted. The reducer now promotes at most 32
  stable rows per assistant block group; the remaining message mounts 32 head + 64 tail blocks by
  default and expands on demand. On 256KiB mixed Markdown, feedback p95 improved 94.6%, Long Task
  89.5%, DOM 98.1%, AX 98.0%, and post-GC heap 92.6%. Expanded canonical text hash and turn-copy
  source reconstruction match the unbounded baseline exactly.
- `MD-CACHE-01` byte-bounded highlight cache: accepted. An 80-entry TypeScript token-tree workload
  retained 14.60MB after GC with the entry-only cache versus 8.99MB with an 8MiB weighted budget
  (-38.4%); the candidate retained 48 entries and evicted 32 while preserving LRU semantics.
- `MD-PARSER-01` shared MarkdownIt instance: rejected at P0. Against a same-commit rollback control,
  feedback p95 improved 9.9% and post-GC heap 4.3%, but end-to-end p95 regressed 0.4% and Long Task
  improved only 0.8%. The implementation was rolled back pending a history-specific benchmark.
- `MD-P0-FINAL`: accepted combination verification. The final three accepted changes cut 64KiB
  open-code feedback p95 91.3%, frame-gap p95 93.4%, and heap 46.2%; on 256KiB mixed Markdown they
  cut feedback p95 97.4%, Long Task 92.7%, frame-gap 96.5%, heap 91.5%, and DOM/AX about 98%.
  The 1MiB plain control kept end-to-end p95 within -0.6%, frame-gap within +1.9%, and heap flat.

Only v4 runs may promote expandable-renderer candidates. v1 missed later main-thread stalls; v3
hashed artificial React root boundaries. Both remain calibration evidence only.
