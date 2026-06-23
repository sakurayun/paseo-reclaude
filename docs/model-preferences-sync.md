# Model preferences sync

The user's **model selection habits** (last-used provider, and per-provider last-used
model and mode), **favorite models**, and **per-model settings** (the thinking /
reasoning-effort option and feature toggles) sync across every client connected to the
same daemon — mobile included. Favorite a model on a desktop and a connected phone shows
it; change the default model on either of two desktops and the other follows. The choice
survives a daemon restart and is handed to a freshly connected device.

This is a fork feature, gated on `server_info.features.modelPreferencesSync`. An old daemon
doesn't advertise it and every client stays purely local.

It is the sibling of [appearance-settings-sync.md](appearance-settings-sync.md) and
[workspace-layout-sync.md](workspace-layout-sync.md), and reuses the same opaque-blob +
revision-LWW + pull-before-push machinery. The one structural difference: the synced store
is the create-agent "form preferences" cache, not the AppSettings cache.

## What syncs

Everything in the client-local `FormPreferences` blob (AsyncStorage key
`@paseo:create-agent-preferences`):

| Field                                    | Meaning                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| `provider`                               | last-selected provider                                  |
| `providerPreferences[p].model`           | last-used model for provider `p`                        |
| `providerPreferences[p].mode`            | last-used mode (e.g. plan/agent) for provider `p`       |
| `providerPreferences[p].thinkingByModel` | per-model thinking / reasoning-effort option            |
| `providerPreferences[p].featureValues`   | per-provider feature toggles (web search, fast mode, …) |
| `favoriteModels[]`                       | favorited `{provider, modelId}` pairs                   |
| `isolation`                              | last-used create isolation (local / worktree)           |

The synced subset is defined in **one place**: `extractSynced` in
`packages/app/src/stores/model-preferences-sync.ts`. Today it is the whole blob; to make a
field device-local, drop it there — the protocol blob is opaque and needs no change.

### What deliberately does NOT sync

Model **gateways** (`modelGateways` in the daemon config) are **not** part of this. They
already live daemon-side (`$PASEO_HOME/config.json`), are already shared by every client of
that daemon, and contain a plaintext `apiKey`. Routing them through a client-managed sync
blob would exfiltrate the secret across the relay/cloud path. Gateways stay daemon-side
only; this feature touches only the secret-free `FormPreferences` blob.

## Data flow

```
Device A favorites a model / changes default model / toggles a feature
  → FormPreferences React Query cache (["form-preferences"]) updates via updatePreferences
  → model-preferences-sync bridge (queryCache.subscribe) debounces ~300ms, then
    pushModelPreferences({ revision, preferences })
Daemon  model.preferences.push.request
  → FileBackedModelPreferencesStore.applyPush — revision arbitration (last-write-wins)
  → emit model.preferences.push.response (accepted, authoritative revision)
  → if accepted: broadcast model.preferences.changed to ALL other clients (excl. sender)
Device B (desktop OR mobile)  model.preferences.changed
  → revision check drops echoes / stale
  → applyRemote → parseFormPreferences → CreateAgentPreferencesService.update + setQueryData
New device C connects
  → model.preferences.get.request pulls the current snapshot
  → empty store + web → seed from local; non-empty → adopt remote
```

## Why an opaque blob

The protocol types `preferences` as `z.record(z.string(), z.unknown())` and the **daemon
never parses it** — it stores, arbitrates by revision, and fans the blob out verbatim. On
apply, the client revalidates with `parseFormPreferences` (the same parser used on load), so
a malformed or older peer can't inject invalid state, and provider/version-specific
`featureValues` are pruned at read time downstream. Future synced fields never touch the
protocol.

## Anti-loop

All sync logic lives in one off-React module,
`packages/app/src/stores/model-preferences-sync.ts`. Because the preferences live in React
Query (not a Zustand store), the primary guard is **JSON dedupe** (`lastSyncedJson`): every
push and every applied remote update records the synced-subset JSON it produced; the cache
notification that immediately follows is recognized as a no-op. `applyRemote` sets
`lastSyncedJson` _before_ the async `CreateAgentPreferencesService.update`, closing the
persist-window race. `applyingRemote` is a belt-and-suspenders flag, and an incoming
`changed` with `revision <= ours` is dropped.

`parseFormPreferences` is idempotent and key-order-stable (zod emits object keys in schema
order; records preserve input order), so the JSON predicted in `applyRemote` equals the JSON
`readSynced` produces after the apply — the echo is reliably deduped.

## Pull-before-push & desktop seeding

A bridge does not push until `initialPull` has fetched the daemon snapshot. On connect:

- **Non-empty store** → adopt the remote envelope (remote wins; fresh device picks up the
  existing preferences).
- **Empty store (revision 0)** → only a **web/desktop** client seeds it from its local
  preferences (`isWeb`). A mobile client does **not** seed; it stays local until the store is
  populated, then adopts. This realizes "mobile follows the desktop" without a
  source-election protocol. Once non-empty, any device's explicit change propagates.

## Conflict policy

A single global envelope carries a monotonically increasing revision; `applyPush` rejects
any push whose revision is not strictly greater than the stored one, and the rejected client
re-pulls and adopts the authoritative envelope. This is whole-blob last-write-wins (revision,
not timestamp, to avoid clock skew) — the same trade-off as appearance sync: two devices
editing favorites within the same ~300ms window can clobber each other's edit. Acceptable for
v1; matches the existing sync features.

## Code map

- **Protocol** — `packages/protocol/src/messages.ts`: `ModelPreferencesEnvelopeSchema`,
  `model.preferences.push.request`/`.response`, `model.preferences.get.request`/`.response`,
  `model.preferences.changed`, and the `modelPreferencesSync` feature flag.
- **Daemon** — `model-preferences-store.ts` (FileBacked, revision arbitration, persists to
  `$PASEO_HOME/model-preferences.json`); `session.ts`
  `handleModelPreferencesPushRequest`/`GetRequest` + `dispatchModelPreferencesMessage`;
  `websocket-server.ts` `broadcastModelPreferencesChanged` (**no deviceType filter** — mobile
  shares it too); `bootstrap.ts` constructs and injects the store.
- **Client** — `daemon-client.ts` `pushModelPreferences`/`getModelPreferences`.
- **App** — `model-preferences-sync.ts` (the bridge); `hooks/use-form-preferences.ts` exports
  `FORM_PREFERENCES_QUERY_KEY`; mounted in `contexts/session-context.tsx`.

## COMPAT cleanup

`COMPAT(modelPreferencesSync)` — added v0.1.108, remove the gate after 2026-12-23. Grep
`rg "COMPAT\(modelPreferencesSync"` for every site.
