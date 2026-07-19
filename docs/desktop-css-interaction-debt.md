# Desktop CSS interaction performance debt

Baseline: 2026-07-19 on `perf/desktop-interaction-followup` at `b8e0a0c29`.
Baseline evidence: `20260719_230204__static_inventory_property_access__65a27b`.
First-wave evidence: real Electron benchmark at `3aab41883` before the CSS changes and the working
tree after the changes; full method and values are recorded in
`experiments/2026-07-19_desktop_css_interactions/results.md`.

## What counts as debt

This ledger counts Desktop-web visual feedback that currently passes through React or React Native
Web interaction state:

- explicit `onHoverIn` / `onHoverOut` or pointer enter/leave handlers;
- explicit hover/press `useState` cells;
- `Pressable` style or child render callbacks consuming `hovered` / `pressed`;
- hover/press state propagated into child components for colors, opacity, icons, or visibility.

These counts overlap and must not be summed as unique controls. A callback source site can be reused
by hundreds of mounted rows, while several source sites can describe one control.

## Static baseline

The TypeScript AST scanner covers 887 production `.ts` / `.tsx` files under `packages/app/src`,
excluding tests and the generated xterm WebView bundle.

| Mechanism                              | Count | Scope                            |
| -------------------------------------- | ----: | -------------------------------- |
| Interaction callback/prop sites        |   173 | 72 files                         |
| Sites consuming hover state            |   149 | overlaps pressed sites           |
| Sites consuming pressed state          |   109 | overlaps hover sites             |
| Explicit React hover/press state cells |    32 | 19 files                         |
| Explicit hover tracker pairs           |    34 | 17 `onHover*` + 17 pointer pairs |
| Explicit press-phase bindings          |    19 | 13 press-in + 6 press-out        |

High-frequency component families account for 105 of the 173 callback/prop sites:

| Family                    | Callback/prop sites | Hover | Press | Files |
| ------------------------- | ------------------: | ----: | ----: | ----: |
| Sidebar                   |                  32 |    28 |    11 |    11 |
| Workspace chrome and tabs |                  20 |    16 |    13 |     5 |
| Git, diff, and review     |                  18 |    17 |    10 |     6 |
| Composer                  |                  16 |    14 |     6 |     4 |
| UI primitives             |                  14 |    13 |    12 |    10 |
| Timeline and subagents    |                   5 |     4 |     4 |     3 |

Largest source hotspots use an overlap-aware audit score: callback sites + explicit event bindings +
interaction state cells. It is a prioritization signal, not a runtime cost measurement.

| File                                               | Audit score | Why it matters                                                       |
| -------------------------------------------------- | ----------: | -------------------------------------------------------------------- |
| `components/sidebar-workspace-list.tsx`            |          27 | Repeated project/workspace rows, actions, drag and hover reveals     |
| `git/pull-request-panel/pane.tsx`                  |          18 | Repeated checks, entries, thread headers, kebab and refresh controls |
| `components/message.tsx`                           |          17 | Repeated message rows and tool badges on the active timeline         |
| `git/diff-pane.tsx`                                |          12 | Hover state can exist once per mounted diff line/gutter              |
| `screens/workspace/workspace-desktop-tabs-row.tsx` |          11 | Every visible tab plus close-button state and parent bookkeeping     |

## First-wave static result

The scanner was rerun after the first six component-family migrations. New platform-specific style
modules increase scanned source files from 887 to 907, so source-file count is not a performance
metric. The interaction mechanisms are directly comparable:

| Mechanism                       | Before | After |       Delta |
| ------------------------------- | -----: | ----: | ----------: |
| Interaction callback/prop sites |    173 |   167 |  -6 (-3.5%) |
| Hover callback/prop sites       |    149 |   143 |  -6 (-4.0%) |
| Press callback/prop sites       |    109 |   104 |  -5 (-4.6%) |
| Explicit interaction state      |     32 |    23 | -9 (-28.1%) |
| Explicit hover tracker pairs    |     34 |    27 | -7 (-20.6%) |
| Explicit press-phase bindings   |     19 |    17 | -2 (-10.5%) |

The scanner intentionally still counts native fallback callbacks. The runtime improvement is larger
than the source-site delta where one removed state cell was mounted once per tab, message, or diff
line.

## Performance debt ledger

Each row is a separate ablation. Do not migrate multiple component families in one commit.

| Rank | ID                      | Priority | Runtime multiplier                                           | Candidate boundary                                                              | Status                        |
| ---: | ----------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
|    0 | CSS-BENCH-01            | P0       | 100 hover/active cycles under idle and 256KiB stream load    | Record feedback p50/p95, React commits, handlers, long tasks, frames, DOM/AX    | idle measured; stream pending |
|    1 | CSS-TABS-01             | P0       | 1/8/20 visible tabs; exercised constantly                    | Remove per-tab hover state and parent close-hover key from visual styling       | implemented; measured         |
|    2 | CSS-BUTTON-01           | P0       | Shared primitive used across the app                         | Add a web-specific visual fast path for Button; keep native Pressable           | implemented; isolated test    |
|    3 | CSS-TIMELINE-01         | P0       | 50/100/176 mounted history plus live stream                  | User-message actions, tool badges, code/copy buttons, subagent rows             | partial: user-message actions |
|    4 | CSS-DIFF-01             | P0       | 500/2,000/5,000 diff lines                                   | Use parent/group hover to reveal gutter actions without per-line React state    | partial: review gutters       |
|    5 | CSS-SIDEBAR-01          | P1       | Projects/workspaces/status rows                              | Move row background, text/icon color, chevron/kebab visibility to CSS           | partial: project rows         |
|    6 | CSS-MENU-01             | P1       | Dropdown, context menu, combobox, select, segmented controls | Move visual hover/active only; keep open, focus, roving index, selection in JS  | partial: static triggers      |
|    7 | CSS-COMPOSER-01         | P1       | Always-visible controls during streaming                     | Attach, voice, mode, model, agent and send-control visual states                | partial: attach and voice     |
|    8 | CSS-EXPLORER-01         | P1       | File/Changes/PR result counts                                | File rows, sort/menu buttons, PR checks and thread headers                      | next wave                     |
|    9 | CSS-BROWSER-TERMINAL-01 | P1       | Persistent desktop panes                                     | Browser toolbar and terminal toolbar icon-button visuals                        | partial: browser toolbar      |
|   10 | CSS-RARE-01             | P2       | Settings, create flows, sheets and diagnostics               | Migrate after shared primitives settle                                          | queued                        |
|   11 | HOVER-POLICY-01         | P1       | All future hover work                                        | Resolve pointer-handler guidance conflict before establishing the new primitive | blocked-on-design             |

## First ablation: workspace tabs

Workspace tabs are the safest high-frequency slice because the instance count and behavior are
bounded, while the current implementation has both local `hovered` state and a parent-level
`hoveredCloseTabKey` update. The candidate should:

1. preserve active, focused, dragging, closing, context-menu, tooltip, and middle-click semantics;
2. move label highlight, close-button reveal, icon color, background, and `:active` feedback to a
   Desktop-web stylesheet;
3. retain native behavior in the native/base implementation;
4. avoid adding wrapper DOM or AX nodes;
5. use stable data attributes only for semantic state such as active/closing, never for hover.

Measured outcome: 100 tab sweeps retained 201 RN Web `Pressable` leaf commits in both variants, but
tab-row React `actualDuration` fell 70.9% at 8 tabs and 69.6% at 20 tabs. One tab was noise-bound
(48.3ms to 53.4ms total). Idle feedback p95 stayed 0.2-0.4ms, both variants recorded zero long tasks
and dropped frames, DOM count was unchanged, and AX count did not increase. This is a partial pass:
the application-level tab/parent cascade was removed, but RN Web still owns internal hover state.
The 256KiB contention run remains required before closing CSS-TABS-01.

## What must stay in JavaScript

CSS should own visual feedback, not semantic state. Keep these behaviors in JS and split their visual
decoration from their semantic event when possible:

- assistant file-link hover prefetch and target resolution;
- workspace hover-card delay, safe-zone bridge, and portal lifetime;
- toast auto-dismiss pause/resume;
- resize and drag gestures, long-press detection, pointer capture, and cursor ownership;
- menu open/close, keyboard focus, roving index, selection, and async pending state;
- copied/success/loading/error state and any content whose accessibility label changes;
- native and compact-layout visibility fallbacks.

CSS pseudo-classes remove React scheduling, state allocation, prop propagation, and interaction-only
commits. They do not bypass a renderer main-thread long task, so the benchmark must measure both idle
and live-stream contention rather than promising compositor-independent feedback.

## Architecture constraint

Replacing explicit state with `Pressable`'s `({ hovered, pressed })` render prop is not a CSS fast
path. RN Web `Pressable` also retains internal hovered/pressed state with static children and styles,
so CSS on an existing Pressable removes application-level state and propagation but not its leaf
commit. The shared Electron `Button` host avoids Pressable only for ordinary click/keyboard buttons;
gesture-phase, long-press, hit-slop, and render-function cases retain Pressable. Native always retains
Pressable.

Current guidance also conflicts: `docs/hover.md` prescribes pointer enter/leave for coordinated hover,
while repository platform rules forbid adding those handlers. CSS migration reduces this conflict for
visual-only feedback, but HOVER-POLICY-01 must settle the semantic-hover rule before new shared APIs.
