# Notes: desktop_css_interactions

- Static counts are source sites, not mounted runtime instances, and the metrics overlap. Do not add
  callback, state-cell, and event-binding counts together.
- The scanner excludes tests and the generated xterm WebView bundle.
- A `Pressable` render-prop callback remains JS-driven; replacing explicit `useState` with
  `({ hovered, pressed }) => ...` does not qualify as CSS.
- CSS pseudo-classes bypass React scheduling and commits, but they do not make a renderer main-thread
  long task disappear. Measure both idle and streaming-load feedback.
- Keep semantic JS behavior: file-link prefetch, hover-card safe zones, toast timers, drag/long press,
  resize gestures, menu open/selection, copy confirmation, and native fallbacks.

## Baseline

Run `20260719_230204__static_inventory_property_access__65a27b` scanned 887 production source files and found 173
interaction callback/prop sites across 72 files, including 149 hover consumers, 109 press consumers,
32 explicit React interaction state cells, 34 explicit hover tracker pairs, and 19 press-phase
bindings. Metrics overlap and are not additive.
