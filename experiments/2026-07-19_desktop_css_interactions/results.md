# Results: Desktop CSS interactions, first wave

Date: 2026-07-19

## Variants

- Before: `3aab41883`, which contains the runtime benchmark but none of the CSS migrations.
- After: the first-wave working tree on `perf/desktop-interaction-followup`.
- Runtime: real Electron-overlay Chromium, isolated random daemon and Metro ports, never port 6767.
- Workload: 1, 8, and 20 visible agent tabs; 100 scripted hover cycles per case.

The benchmark records pointer dispatch to the next animation frame, React Profiler commits and
`actualDuration` for the tab row, Long Tasks, frame gaps, dropped frames, DOM nodes, and AX nodes.
Constructable stylesheets are used in Electron, so interaction CSS adds no DOM node.

## Runtime result

| Tabs | Feedback p50 before/after | Feedback p95 before/after | Tab-row commits before/after | Tab-row actualDuration before/after | Change |
| ---: | ------------------------- | ------------------------- | ---------------------------- | ----------------------------------- | -----: |
|    1 | 0.2 / 0.2 ms              | 0.3 / 0.3 ms              | 201 / 201                    | 48.3 / 53.4 ms                      | +10.6% |
|    8 | 0.2 / 0.2 ms              | 0.3 / 0.4 ms              | 201 / 201                    | 203.3 / 59.1 ms                     | -70.9% |
|   20 | 0.2 / 0.2 ms              | 0.2 / 0.3 ms              | 201 / 201                    | 166.7 / 50.6 ms                     | -69.6% |

Both variants recorded zero Long Tasks and zero dropped frames. Maximum frame gaps were 15.9/19.7ms
for one tab and 9.4/9.4ms for both 8 and 20 tabs. DOM nodes were exactly unchanged at 374, 510, and 730. AX nodes did not increase: 257/252, 355/350, and 425/418; the small reductions are treated as
measurement noise, not a product claim.

The retained 201 commits are RN Web `Pressable`'s internal leaf hover state. The improvement at 8 and
20 tabs comes from removing the tab's application hover state and the workspace-level
`hoveredCloseTabKey` cascade. The one-tab regression and sub-millisecond feedback differences are
noise-bound; no direct input-latency claim is supported by this run.

## Static result

| Metric                        | Before | After |  Delta |
| ----------------------------- | -----: | ----: | -----: |
| Callback/prop sites           |    173 |   167 |  -3.5% |
| Explicit interaction state    |     32 |    23 | -28.1% |
| Explicit hover tracker pairs  |     34 |    27 | -20.6% |
| Explicit press-phase bindings |     19 |    17 | -10.5% |

## Scope delivered

- Workspace tabs: CSS label/icon/close/action feedback; removed tab state and parent close-hover key.
- Shared Button: Electron static host for ordinary buttons; Pressable fallback for gesture semantics.
- Diff/review: CSS pseudo-element gutter action; no icon DOM/AX node per line.
- Sidebar: CSS row/chevron/action reveal for project rows.
- Composer: CSS attach and voice visual hover.
- Timeline: CSS user-message trailing actions with `:focus-within` keyboard fallback.
- Browser: CSS toolbar hover/active; menu/context triggers avoid unnecessary render callbacks.

## Open gates

- Repeat the runtime benchmark while a frozen 256KiB stream workload occupies the renderer.
- Add isolated mounted-instance benchmarks for 500/2,000/5,000 diff rows and 50/100/176 messages.
- Visually compare the CSS-drawn sidebar chevron and diff plus glyph on Electron.
- The existing workspace-tab rename E2E is environment-blocked because its seed helper selected the
  unavailable `opencode` provider. Three diff alignment E2E cases and the sidebar hover-action E2E
  passed.
