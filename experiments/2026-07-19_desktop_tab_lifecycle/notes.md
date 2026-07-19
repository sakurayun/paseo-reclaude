# Notes: desktop_tab_lifecycle

- Baseline is the accepted Desktop-web timeline policy: virtualization threshold 50 and mounted
  recent window 20.
- The ablation changes only which Agent tab roots remain mounted. It does not change Markdown,
  timeline projection, query caching, stream reduction, or non-Agent tab retention.
- The benchmark launches an isolated daemon and blocks requests and WebSockets to port 6767.
- Chromium heap/DOM/AX measurements are the reproducible gate. Physical footprint, swap, and
  page-in still require a separate isolated real-Electron CDP run.

## Same-source result

The retained and active-only runs have the same tracked source patch hash
`72c3a8582a6c552906347cb48e800b5c7aa84f893e4f6c73293aafa861a261d3`.
The registry now defaults to the retained product policy; set
`PASEO_BENCHMARK_RETAIN_INACTIVE_AGENT_TIMELINES=0` to reproduce the active-only candidate.

| Slice   | Variant     |   Body p50/p95 | DOM / inactive DOM | Post-GC heap | React p95 |
| ------- | ----------- | -------------: | -----------------: | -----------: | --------: |
| 8 x 50  | retained    | 94.1 / 181.9ms |      4,312 / 2,204 |     174.1MiB |   841.8ms |
| 8 x 50  | active-only | 85.9 / 156.4ms |          1,940 / 0 |     139.7MiB |   720.0ms |
| 8 x 100 | retained    | 93.3 / 294.0ms |        2,540 / 886 |     149.8MiB | 1,159.5ms |
| 8 x 100 | active-only | 79.9 / 143.6ms |          1,486 / 0 |     136.9MiB |   655.1ms |
| 8 x 176 | retained    | 84.8 / 149.9ms |        2,531 / 886 |     147.3MiB |   690.0ms |
| 8 x 176 | active-only | 92.4 / 170.2ms |          1,477 / 0 |     137.0MiB |   772.6ms |

Active-only removes all inactive timeline DOM, but the decisive 8 x 176 case improves post-GC heap
only 7.0% (gate: at least 15%) while body p95 regresses 13.5% and React p95 regresses 12.0%.
Therefore it is not the product default. Its product behavior and scroll-state companion change are
not promoted; the explicit override keeps the lifecycle ablation reproducible.
