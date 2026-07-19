# Desktop CSS interaction performance debt

Baseline: 2026-07-19 on `perf/desktop-interaction-followup` at `b8e0a0c29`.
Evidence run: `20260719_230204__static_inventory_property_access__65a27b`.

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

## Performance debt ledger

Each row is a separate ablation. Do not migrate multiple component families in one commit.

| Rank | ID                      | Priority | Runtime multiplier                                           | Candidate boundary                                                              | Status            |
| ---: | ----------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------- |
|    0 | CSS-BENCH-01            | P0       | 100 hover/active cycles under idle and 256KiB stream load    | Record feedback p50/p95, React commits, handlers, long tasks, frames, DOM/AX    | measuring         |
|    1 | CSS-TABS-01             | P0       | 1/8/20 visible tabs; exercised constantly                    | Remove per-tab hover state and parent close-hover key from visual styling       | queued            |
|    2 | CSS-BUTTON-01           | P0       | Shared primitive used across the app                         | Add a web-specific visual fast path for Button; keep native Pressable           | queued            |
|    3 | CSS-TIMELINE-01         | P0       | 50/100/176 mounted history plus live stream                  | User-message actions, tool badges, code/copy buttons, subagent rows             | queued            |
|    4 | CSS-DIFF-01             | P0       | 500/2,000/5,000 diff lines                                   | Use parent/group hover to reveal gutter actions without per-line React state    | queued            |
|    5 | CSS-SIDEBAR-01          | P1       | Projects/workspaces/status rows                              | Move row background, text/icon color, chevron/kebab visibility to CSS           | queued            |
|    6 | CSS-MENU-01             | P1       | Dropdown, context menu, combobox, select, segmented controls | Move visual hover/active only; keep open, focus, roving index, selection in JS  | queued            |
|    7 | CSS-COMPOSER-01         | P1       | Always-visible controls during streaming                     | Attach, voice, mode, model, agent and send-control visual states                | queued            |
|    8 | CSS-EXPLORER-01         | P1       | File/Changes/PR result counts                                | File rows, sort/menu buttons, PR checks and thread headers                      | queued            |
|    9 | CSS-BROWSER-TERMINAL-01 | P1       | Persistent desktop panes                                     | Browser toolbar and terminal toolbar icon-button visuals                        | queued            |
|   10 | CSS-RARE-01             | P2       | Settings, create flows, sheets and diagnostics               | Migrate after shared primitives settle                                          | queued            |
|   11 | HOVER-POLICY-01         | P1       | All future hover work                                        | Resolve pointer-handler guidance conflict before establishing the new primitive | blocked-on-design |

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

Promotion gate: 100 hover sweeps produce zero React commits attributable to visual hover, idle
feedback p95 is at most 16.7ms, 256KiB-stream feedback p95 improves by at least 30%, DOM/AX counts do
not increase, and keyboard focus-visible plus tab close/context-menu behavior remain correct.

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
path. For Desktop web, use a `.web.tsx` / `.electron.tsx` primitive or a web-only stylesheet attached
through stable classes/data attributes. Native continues to use Pressable. Icon color inheritance and
focus-visible behavior need a proof in the first ablation before a global primitive migration.

Current guidance also conflicts: `docs/hover.md` prescribes pointer enter/leave for coordinated hover,
while repository platform rules forbid adding those handlers. CSS migration reduces this conflict for
visual-only feedback, but HOVER-POLICY-01 must settle the semantic-hover rule before new shared APIs.
