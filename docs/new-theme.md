# New theme (fork feature)

A standalone, redesigned **light** look, toggled independently of the theme
dropdown. Fork-only; not present upstream. This is an intentionally incremental
feature, meant to grow. So far it: (1) paints sidebars/chrome `#fafafa`;
(2) floats the desktop content (tabs + panes) as an inset rounded white card on
that `#fafafa` underlay, vertical sidebar dividers removed; (3) exposes the
workspace header on the `#fafafa` backdrop above the card (shorter, no divider);
(4) restyles the tab row — each tab a `#fafafa` rounded chip, no inter-tab
dividers, create/right buttons as `#fafafa` rounded squares; (5) replaces the
left sidebar's project-grouped list with a flat, recency-sorted **sessions**
list + a 3-button top toolbar (new conversation / open project / history), with
the footer divider and the redundant open-project/home footer buttons dropped
(see "Left sidebar — flat sessions"); and (6) harmonizes the **right panel**
(ExplorerSidebar) to match — all dividers gone, rounded 12px hovers, PR/Git
activity cards floating as borderless white cards (see "Right panel — echo the
left"); and (7) tints the scrollbars `#fafafa` (`scrollbarHandle` override) so
the native and overlay scrollbars melt into the `#fafafa` chrome instead of
cutting a darker bar across it.

## What the user sees

Settings → Appearance → **New theme** switch (the first section, above the theme
dropdown). Default **on** — new and existing installs alike boot into the new
theme until a user turns it off. When on, it overrides the theme dropdown
entirely: even if the dropdown says "Dark", the app renders the new light theme.

On desktop: the workspace header sits on the `#fafafa` backdrop; below it the tabs
and message panes float as one rounded white card, inset on the left/right/bottom
(flush to the header at the top), the `#fafafa` showing through the gaps and where
the sidebars are (their vertical dividers are gone). Compact (phone) is unchanged —
no pinned sidebars there, so no card.

## How it works

- **Setting** — `newThemeEnabled: boolean` on `AppSettings`
  (`packages/app/src/hooks/use-settings/storage.ts`), default
  `DEFAULT_NEW_THEME_ENABLED = true`. Parsed in `pickMiscAppSettings`.
  **Device-local on purpose**: deliberately _not_ in `extractSyncedAppearance` /
  `pickSyncedAppearance`, so toggling it on one device does not sync to others
  (unlike `theme` / `syntaxTheme` / `terminalColorScheme`).
- **Theme** — a dedicated Unistyles theme registered under the key `newTheme`
  (`packages/app/src/styles/unistyles.ts`), built from `newThemeSemanticColors`
  in `packages/app/src/styles/theme.ts`. That object is derived from
  `lightSemanticColors` so it inherits every token by default. **This is the
  single place to grow the new theme** — add overrides to `newThemeSemanticColors`
  (colors) or `newThemeShell` (layout). `newTheme` is NOT a dropdown `ThemeName`;
  it is a separate Unistyles key only.
- **Switch** — `_layout.tsx` `ProvidersWrapper` theme effect: when
  `settings.newThemeEnabled` is true it calls `setAdaptiveThemes(false)` +
  `setTheme("newTheme")` and returns early, ignoring `settings.theme`. When off,
  the existing dropdown/auto logic runs.
- **Font/size/syntax** — `newTheme` is in `ALL_THEME_KEYS`
  (`apply-appearance.ts`) so `applyAppearance` patches its fonts, sizes, and
  syntax colors like every other theme.

## Floating card, exposed header, tab chips (desktop)

The whole shift is **token-driven**, so it reacts through Unistyles with no React
re-render and is auto-gated to the active theme — classic themes are byte-identical.

- **`theme.shell`** (layout tokens, on `commonTheme` in `theme.ts`):
  `contentMargin`, `contentRadius`, `contentOverflow`, `chromeDivider`, and
  `floating` — a boolean (`false` classic / `true` newTheme) that lets any
  stylesheet branch the floating look directly. Classic =
  `0 / 0 / "visible" / 1 / false`; `newTheme` overrides to
  `8 / 12 / "hidden" / 0 / true`. The override is applied where `newTheme` is
  exported: `{ ...buildLightTheme(...), shell: newThemeShell }`.
- **`colors.surfaceShell`** — the shell underlay (revealed in the card's margins)
  and the exposed-header surface. Equals each theme's `surface0` in classic (so it
  is invisible behind the flush classic content and keeps the header
  byte-identical) and `#fafafa` in `newTheme`.
- **Chrome dividers** — `left-sidebar.tsx` / `explorer-sidebar.tsx`
  `desktopSidebarBorder` and the workspace header's bottom border use
  `theme.shell.chromeDivider` (was a literal `1`).
- **The card** — `workspace-screen.tsx`: `threePaneRow` paints `surfaceShell`
  (underlay); `centerColumn` paints `surfaceShell` behind the exposed header; the
  inner `centerCard` paints `surfaceWorkspace` (the white card) wrapping only the
  tabs row + panes, with `marginHorizontal` / `marginBottom` / `borderRadius` /
  `overflow` as **breakpoint objects** (`{ xs: 0, md: theme.shell.* }`) and
  `marginTop: 0` (no gap to the header). The breakpoint object is the desktop gate —
  compact (`xs`/`sm`) stays full-bleed; the card only appears at `md+`. The deep
  pane subtree is extracted to a `centerPaneContent` const to stay under the
  `jsx-max-depth` lint ceiling.
- **Exposed header** — the workspace `ScreenHeader` sits above the card on the
  `#fafafa` backdrop, not inside it. The shared `ScreenHeader` gained optional
  `surfaceStyle` / `rowStyle` overrides; the workspace passes a breakpoint-gated bg
  (`surface0` on `xs`, `surfaceShell` on `md`), a shorter desktop height (40 in the
  new theme), and `borderBottomWidth: chromeDivider` (no divider in the new theme).
- **Tab row** (`workspace-desktop-tabs-row.tsx`, branching on
  `theme.shell.floating`) — no bottom divider, no inter-tab borders; each tab is a
  `#fafafa` (`surface1`) rounded chip centered in a taller (44px) row with symmetric
  8px insets; the active chip uses `surface2` (the top accent bar is hidden); the
  create + right action buttons get a `#fafafa` fill so they read as rounded squares.

## Why `surfaceSidebar` is enough

Every sidebar / outer-chrome surface renders through
`theme.colors.surfaceSidebar`: the main left sidebar
(`components/left-sidebar.tsx`), the settings desktop sidebar
(`screens/settings-screen.tsx`), the file explorer
(`components/explorer-sidebar.tsx`, `components/file-explorer-pane.tsx`), and the
git/PR panes (`git/source-control-pane.tsx`, `git/pull-request-panel/pane.tsx`).
The main content/message area uses `surfaceWorkspace` / `surface0`. Hover/selected
states use `surfaceSidebarHover` (untouched for now).

## Adding a registered theme key — update all enumeration sites

`newTheme` had to be added everywhere the full theme-key set is enumerated. If
you add another theme key, update the same four places (typecheck catches the
typed ones; the test asserts the literal list):

1. `packages/app/src/styles/theme.ts` — the theme definition + export.
2. `packages/app/src/styles/unistyles.ts` — `StyleSheet.configure` themes + the
   `AppThemes` interface.
3. `packages/app/src/screens/settings/appearance/apply-appearance.ts` —
   `ALL_THEME_KEYS`.
4. `packages/app/src/screens/settings/appearance/apply-appearance.test.ts` — the
   mirrored `ALL_THEME_KEYS` assertion.

(`THEME_TO_UNISTYLES` / `VALID_THEMES` are only for dropdown `ThemeName`s —
`newTheme` is not a dropdown option, so it stays out of both.)

## Settings: borderless nested cards

Settings detail pages dropped the bordered-card-with-divider-lines look in favour
of a **flat stack of independent rounded cards** — each setting is its own
`surface1` rounded card (`borderRadius.xl`) on the white content column with a
soft `theme.shadow.sm`, separated by gap, grouped under the muted
`<SettingsSection>` label. It mirrors the home message stream's `#fafafa` bubbles
(`message.tsx`, the `theme.shell.floating ? surface1` user bubble) and reads as
"外边距的圆角矩形" cards instead of one boxed list. No structural borders, no row
dividers anywhere.

**The whole thing pivots on the shared primitives in
`packages/app/src/styles/settings.ts` — change those, not the call sites:**

- `card` — was a bordered `surface1` box; now a **transparent vertical stack**
  (`{ gap }`). The dozens of `<View style={settingsStyles.card}>` sites that wrap
  `settingsStyles.row` children keep working: the rows inside become the cards.
- `row` — now an **independent rounded surface card** (`surface1` +
  `borderRadius.xl` + `padding 16` + `...theme.shadow.sm`, no border).
- `rowBorder` — now a **no-op `{}`**, so the many `[row, rowBorder]` / `isFirst`
  call sites stay valid untouched; the divider is gone, gap separates rows.
- `cardSurface` — **new**. A single borderless rounded panel (`surface1` +
  `borderRadius.xl` + `shadow.sm`, no padding/layout) for **custom (non-row)**
  card content: empty/loading states, text areas, code blocks, bespoke lists.

Theme-aware and global (not gated to `newTheme`): the `theme.shadow.*` tokens
carry their own per-theme values, so dark themes get a stronger shadow and the
borderless cards still separate. Classic themes lose the card border but gain the
shadow.

**Consumers that don't wrap `settingsStyles.row` had to be migrated by hand** —
their custom content used to lean on the old card surface, so the structural
borders/dividers they hand-rolled (`styles.separator`, `styles.divider`,
`borderTopWidth` baked into a local `modelRow`/`scriptRow`/`rowWithBorder`) were
removed and the panel switched to `cardSurface`: `settings-textarea`,
`provider-diagnostic-sheet`, `provider-usage/{list,settings-section}`,
`pair-device-section`, `keyboard-shortcuts-section`, `project-settings-screen`
(each script → its own card), `appearance-section` (`rowWithBorder` → `row`), plus
the empty/loading-state cards in `host-page`, `providers-section`,
`model-gateways-section`, `desktop-updates-section`. Inline `style={[cardSurface,
…]}` arrays are hoisted to module consts (react-perf `jsx-no-new-array-as-prop`).

**Desktop: the whole detail pane floats too.** On desktop the settings detail
column mirrors the workspace floating-card pattern (`workspace-screen.tsx`): the
detail pane (`settings-screen.tsx` `desktopStyles.centerColumn`) paints
`surfaceShell`, the `<ScreenHeader>` (icon + title) sits **exposed on that
underlay above the card** (via its `surfaceStyle`/`rowStyle` overrides —
`detailHeaderSurface` = `surfaceShell`, `detailHeaderRow` borderBottom =
`theme.shell.chromeDivider`), and the scrollable content lives inside a floating
`centerCard` (`surfaceWorkspace` white card, `marginTop`/`marginHorizontal`/
`marginBottom` = `theme.shell.contentMargin`, `borderRadius` =
`contentRadius`, `overflow` = `contentOverflow`). The card adds a softer-but-
stronger-than-the-inner-cards shadow (`...(theme.shell.floating ?
theme.shadow.lg : null)`) so it reads as one floating "component with margins" on
the `#fafafa` backdrop — the inner setting cards (`surface1` + `shadow.sm`) nest
inside it. Classic themes are flush/unchanged (shell tokens 0/0/visible, no
shadow). **Settings sidebar dividers are removed in the new theme:** the right
border (`sidebarStyles.desktopContainer`) and the back-row divider
(`sidebar-header-row.tsx` `container`) are driven by `theme.shell.chromeDivider`
(1 classic / 0 new), and the group `<SidebarSeparator />` between the app and host
groups is render-gated `{theme.shell.floating ? null : <SidebarSeparator />}` (a
render gate rather than a 0px border, so the element doesn't linger in the tree).

**Out of scope on purpose:** functional control outlines stay — text inputs,
dropdown/menu triggers, color swatches, `<StatusBadge>` pills, selection chips.
Only the structural card/divider borders were removed. A future pass could soften
those control outlines too if a fully borderless look is wanted.

## Left sidebar — flat sessions

Under the new theme the left sidebar drops the project/workspace-grouped tree for
a **flat, recency-sorted list of every non-archived agent session** (one row =
one conversation), with a **3-button top toolbar**: new conversation
(`buildHostNewWorkspaceRoute`), open project (`useOpenProjectPicker`), history
(`buildHostSessionsRoute`) — the same handlers the classic sidebar already had.

- **Gate** — `left-sidebar.tsx` reads `useAppSettings().settings.newThemeEnabled`
  into `isNewThemeSidebar` and branches `DesktopSidebar`/`MobileSidebar` between
  the toolbar+flat-list and the classic grouped list. Classic is untouched.
- **Data** — `hooks/use-sidebar-sessions-list.ts`: merges the per-server agent
  history cache (`useAgentHistory`) with the live session store, filters
  archived, sorts by `lastUserMessageAt ?? lastActivityAt` (the user's most
  recent message), exposes `recencyAt` + `projectName` per row.
- **Rows** — reuse `SidebarSessionRow` (`sidebar-workspace-sessions.tsx`) with
  `variant="flat"` → hover/press radius = `theme.shell.contentRadius` (12, the
  content-card radius), plus `subtitle` (project) and `timeOverride` (recencyAt).
- **Components** — `components/sidebar/sidebar-sessions-toolbar.tsx` (icon-over-
  label buttons, press `scale 0.96`, `FadeInDown` stagger; inline close on
  compact) and `components/sidebar/sidebar-sessions-list.tsx`.
- **Footer** — `SidebarFooter` drops its top divider (`sidebarFooterFlat`) and
  hides the now-redundant open-project + home buttons in the new theme; the
  device picker + settings stay.
- i18n: `sidebar.sessionsList.{newConversation,history,empty}` in all six
  resources.

## Right panel — echo the left

The right panel (`ExplorerSidebar` — the changes/files/git/pr tab nav + the file
tree / Source Control / Pull Request panes) is harmonized to the left's look,
all token-driven and classic-identical:

- **Dividers** — every structural line becomes `borderWidth: theme.shell.chromeDivider`
  (the PR section `divider` view uses `height: theme.shell.chromeDivider`) → 0 in
  the new theme, 1 in classic. Sites: explorer tab-bar underline, file-explorer
  pane header + tree/preview split + sheet header, Source Control commit-box top
  line, PR section/thread lines, and the **diff viewer** (`git/diff-pane.tsx`) —
  its header/file-section lines _and_ the structural diff rules (line-number
  gutter, split-view center divider) are gated too, since the user wanted every
  line gone; in the new theme the diff leans on its line-tint / gutter / empty-
  cell background colors for structure instead. Functional separators keep their
  padding so the separation survives as whitespace. Control/input/badge outlines
  stay (same rule as the settings cards section above).
- **Rounded hovers** — interactive rows/tabs use
  `theme.shell.floating ? theme.shell.contentRadius : <classic md/0>` so the
  new-theme hover/active surfaces round to 12 like the left.
- **Floating cards** — PR/Git activity cards switch to borderless white
  (`theme.shell.floating ? surface0 : surfaceSidebar`) + `theme.shadow.sm`, so
  they float on the `#fafafa` panel instead of relying on an outline (shadows
  over borders). `overflow: hidden` stays for corner clipping (its shadow is
  web-visible; native leans on the white-on-`#fafafa` contrast).
- **Tab nav** — `ExplorerTabButton` gains the left toolbar's press `scale 0.96`
  (reanimated transform on a plain Animated.View; theme styles stay on the
  Pressable/Text). Files: `explorer-sidebar.tsx`, `file-explorer-pane.tsx`,
  `git/source-control-pane.tsx`, `git/pull-request-panel/pane.tsx`,
  `git/diff-pane.tsx`.

## i18n

`settings.appearance.newTheme.{title,label,hint,accessibilityLabel}` in all six
`packages/app/src/i18n/resources/*.ts`.
