# Appearance settings sync

The user's **app theme**, **code syntax theme**, and **terminal color scheme** sync across
every client connected to the same daemon — mobile included. Change the theme on a desktop
and a connected phone follows; change it on either of two desktops and the other follows. The
choice survives a daemon restart and is handed to a freshly connected device.

This is a fork feature, gated on `server_info.features.appearanceSettingsSync`. An old daemon
doesn't advertise it and every client stays purely local.

It is the sibling of [workspace-layout-sync.md](workspace-layout-sync.md) and reuses the same
opaque-blob + revision-LWW + pull-before-push machinery. The differences are deliberate and
listed below.

## Scope decisions

| Decision              | Behavior                                                                            | Why                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All devices**       | Mobile syncs too — the daemon broadcast has **no `deviceType` filter**.             | Theme/colors are a global user preference; a phone wanting the same colors as the desktop is the whole point. (Layout sync is desktop-only; this is not.) |
| **Theme/colors only** | Synced fields: `theme`, `syntaxTheme`, `terminalColorScheme`. Nothing else.         | Font sizes and terminal padding are device-ergonomic — a phone and a desktop want different sizes — so they stay device-local.                            |
| **Desktop seeds**     | On an empty daemon store, only a web/desktop client seeds; mobile waits and adopts. | Matches "mobile follows the desktop's config". Seeding is one-time (only while the store is at revision 0); afterwards any device's explicit change wins. |
| **Persisted**         | Daemon stores the blob on disk (`$PASEO_HOME/appearance-settings.json`).            | Survives restart; a new device pulls the current appearance.                                                                                              |

## Data flow

```
Device A changes theme / syntax theme / terminal color scheme
  → AppSettings React Query cache updates (optimistic, via saveAppSettings)
  → appearance-settings-sync bridge (queryCache.subscribe) debounces ~300ms, then
    pushAppearanceSettings({ revision, settings })   // settings = {theme, syntaxTheme, terminalColorScheme}
Daemon  appearance.settings.push.request
  → FileBackedAppearanceSettingsStore.applyPush — revision arbitration (last-write-wins)
  → emit appearance.settings.push.response (accepted, authoritative revision)
  → if accepted: broadcast appearance.settings.changed to ALL other clients (excl. sender)
Device B (desktop OR mobile)  appearance.settings.changed
  → revision check drops echoes / stale
  → applyRemote → persistAppSettings(picked fields) → cache + AsyncStorage update → UI re-renders
New device C connects
  → appearance.settings.get.request pulls the current snapshot
  → empty store + web → seed from local; non-empty → adopt remote
```

The synced subset is defined once by `extractSyncedAppearance` / `pickSyncedAppearance` in
`packages/app/src/hooks/use-settings/storage.ts`. Adding a synced field is a one-line change
there — the protocol blob is opaque and needs no change.

## Why an opaque blob

The protocol types `settings` as `z.record(z.string(), z.unknown())` and the **daemon never
parses it** — it stores, arbitrates by revision, and fans the blob out verbatim. The client
revalidates each field on apply with `pickSyncedAppearance` (the same per-field checks used on
load), so a malformed or older peer can't inject invalid values, and future synced fields never
touch the protocol.

## Revision arbitration (last-write-wins)

A single global envelope carries a monotonically increasing revision. `applyPush` rejects any
push whose revision is not strictly greater than the stored one and returns the stored revision
so the client can realign (it re-pulls and adopts the authoritative envelope). Revision, not a
timestamp, avoids multi-device clock skew.

## Anti-loop

All sync logic lives in one off-React module,
`packages/app/src/stores/appearance-settings-sync.ts`. Because AppSettings lives in React Query
(not a Zustand store), the primary guard is **JSON dedupe**:

1. **`lastSyncedJson`** — every push and every applied remote update records the synced-subset
   JSON it produced. The cache notification that immediately follows is compared against it and
   recognized as a no-op, so it is never echoed back. `applyRemote` sets `lastSyncedJson`
   _before_ calling the async `persistAppSettings`, closing the persist-window race.
2. **`applyingRemote`** flag — belt-and-suspenders over the async persist window.
3. **Revision compare** — an incoming `changed` with `revision <= ours` is dropped.

## Pull-before-push & desktop seeding

A bridge does not push until `initialPull` has fetched the daemon snapshot. On connect:

- **Non-empty store** → adopt the remote envelope (remote wins; this is how a fresh device
  picks up the existing appearance).
- **Empty store (revision 0)** → only a **web/desktop** client seeds it from its local
  appearance (`isWeb`). A mobile client does **not** seed; it stays local until the store is
  populated, then adopts. This realizes "mobile follows the desktop" without a source-election
  protocol. Once the store is non-empty, any device's explicit change propagates normally.

## Code map

- **Protocol** — `packages/protocol/src/messages.ts`: `AppearanceSettingsEnvelopeSchema`,
  `appearance.settings.push.request`/`.response`, `appearance.settings.get.request`/`.response`,
  `appearance.settings.changed`, and the `appearanceSettingsSync` feature flag.
- **Daemon** — `appearance-settings-store.ts` (FileBacked, revision arbitration, persists to
  `$PASEO_HOME/appearance-settings.json`); `session.ts`
  `handleAppearanceSettingsPushRequest`/`GetRequest`; `websocket-server.ts`
  `broadcastAppearanceSettingsChanged` (**no deviceType filter** — the key difference from
  layout sync).
- **App** — `daemon-client.ts` `pushAppearanceSettings`/`getAppearanceSettings`;
  `appearance-settings-sync.ts` (the bridge); `hooks/use-settings/storage.ts`
  `extractSyncedAppearance`/`pickSyncedAppearance`.

## COMPAT cleanup

`COMPAT(appearanceSettingsSync)` — added v0.1.104, remove the gate after 2026-12-22. Grep
`rg "COMPAT\(appearanceSettingsSync"` for every site.
