# Composer draft sync

The **text** of each session's composer draft (an unsent message) syncs across every client
connected to the same daemon — mobile included. Type an unsent message in a session's composer on
one device and a connected phone or second desktop shows the same text in that session; clear or
send it and the peer's draft clears too. The text survives a daemon restart and is handed to a
freshly connected device.

This is a fork feature, gated on `server_info.features.composerDraftsSync`. An old daemon doesn't
advertise it and every client stays purely local.

It reuses the [appearance-settings-sync](appearance-settings-sync.md) machinery (opaque blob +
revision-LWW + pull-before-push) with three draft-specific differences.

## Scope decisions

| Decision                      | Behavior                                                                                             | Why                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **All devices**               | Mobile syncs too — the broadcast has no `deviceType` filter.                                         | An unsent message should follow you across devices. (Like appearance sync, unlike layout.) |
| **Text only**                 | Only `text` of `lifecycle: "active"` drafts syncs; attachments stay device-local.                    | Attachments reference per-device local files (`storageKey`) that would dangle on a peer.   |
| **Protect in-progress edits** | A draft you are actively editing is never overwritten by a remote update (per-draft 3-way merge).    | Avoids a peer's push rolling back characters you are typing.                               |
| **Per-server**                | Drafts are keyed `{prefix}:{serverId}:{rest}`; a per-server bridge only syncs its serverId's drafts. | Matches the other per-server sync bridges.                                                 |

## Empty workspace draft tab reuse

Opening a new-agent tab inside an existing workspace should first look for an
already-open workspace draft tab with no active draft input (no non-whitespace
text and no attachments). If one exists, focus that tab instead of creating
another empty draft. This policy is centralized in `prepare-workspace-tab.ts` and
is used by both route-driven opens (`navigateToPreparedWorkspaceTab`) and the
workspace header's local new-agent action.

Do not reuse draft tabs that carry setup/autosubmit state or an active create
flow; those tabs represent a prepared or in-progress operation even if their
composer text is empty.

## Data flow & anti-loop

Mirrors appearance-settings-sync, but the synced store is the Zustand `useDraftStore` (subscribed
directly) rather than a React Query cache, and dedupe/merge is **per-draft** — `lastSynced` is a
`Map<draftKey, text>`, not one JSON string:

- **Push** — a store change → debounce **600 ms** (typing is high-frequency) → extract active
  drafts as `{draftKey: text}` → `pushComposerDrafts({ revision, drafts })`. Deduped against the
  `lastSynced` map; only the current server's drafts are included.
- **Apply (per-draft three-way merge)** — for each draftKey: base = `lastSynced[key]`, local =
  current store text, remote = incoming. `local === base` (no un-pushed edit) → adopt remote
  (set, or clear when remote dropped it); `local !== base` (editing) → keep local and leave
  `lastSynced` at base so the next debounce re-pushes the in-progress edit.
- **UI reflection** — `composer/draft/input-draft.ts` subscribes the store and reflects remote
  text into the live `text` state, guarded by `lastReflectedTextRef` so a local keystroke in the
  one-frame window before it reaches the store is not clobbered.
- **Pull-before-push + seeding** — on connect, pull first; an empty store (revision 0) is seeded
  from a web/desktop client only (mobile adopts); a non-empty store wins.

## Why text only (no attachments)

A draft's attachments are `UserComposerAttachment[]` whose image entries hold a `storageKey` into
the **device-local** attachment store. Syncing them would hand a peer a key to a file it doesn't
have. So the sync blob carries only `text`; each device keeps its own attachments, and a remote
apply preserves the local draft's attachments while replacing the text.

## Code map

- **Protocol** — `packages/protocol/src/messages.ts`: `ComposerDraftsEnvelopeSchema`,
  `composer.drafts.push`/`.get`/`.changed`, capability `composerDraftsSync`.
- **Daemon** — `composer-drafts-store.ts` (FileBacked, revision arbitration, persists to
  `$PASEO_HOME/composer-drafts.json`); `session.ts` handlers; `websocket-server.ts`
  `broadcastComposerDraftsChanged` (**no deviceType filter**).
- **Client** — `daemon-client.ts` `pushComposerDrafts` / `getComposerDrafts`.
- **App** — `stores/composer-drafts-sync.ts` (the bridge); `composer/draft/input-draft.ts` (UI
  reflection + edit protection); `contexts/session-context.tsx` (mount, beside the other 5 bridges).

## COMPAT cleanup

`COMPAT(composerDraftsSync)` — added v0.1.113, remove the gate after 2026-12-25. Grep
`rg "COMPAT\(composerDraftsSync"` for every site.
