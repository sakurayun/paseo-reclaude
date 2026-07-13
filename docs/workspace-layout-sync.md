# Workspace layout sync

Desktop tab-layout operations — **reorder, move tab to another pane, split, close** — sync
across desktop clients connected to the same daemon. Open the same workspace on two desktop
windows and a change in one shows up in the other; the layout also survives a daemon restart
and is handed to a freshly connected desktop.

This is a fork feature. It is gated on `server_info.features.workspaceLayoutSync`; an old
daemon simply doesn't advertise it and clients stay purely local.

## Scope decisions

| Decision              | Behavior                                                                    | Why                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop-only**      | Mobile / compact clients keep their own independent local tab view.         | Small screens don't want a desktop's multi-pane split. Daemon filters by `clientActivity.deviceType !== "mobile"`; the app bridge also gates on `supportsDesktopPaneSplits()`. |
| **Focus not synced**  | The active pane / active tab stay local on each client.                     | Each window should be free to look at a different tab.                                                                                                                         |
| **Split sizes local** | The split _structure_ syncs; the dragged size ratio of each split does not. | Like focus, the ratio depends on the local screen — forcing it across differently-sized screens is worse than leaving it local.                                                |
| **Persisted**         | Daemon stores layouts on disk.                                              | Survives restart; a new desktop pulls the current layout.                                                                                                                      |

## Data flow

```
Desktop A reorders / moves / splits / closes a tab
  → local workspace-layout-store updates (optimistic)
  → workspace-layout-sync bridge (store.subscribe) debounces ~300ms, then
    pushWorkspaceLayout({ workspaceId, revision, layout })   // layout = focus-stripped blob
Daemon  workspace.layout.push.request
  → ownership check (workspace exists & not archived)
  → FileBackedWorkspaceLayoutStore.applyPush — revision arbitration (last-write-wins)
  → emit workspace.layout.push.response (accepted, authoritative revision)
  → if accepted: broadcast workspace.layout.changed to other desktop clients (excl. sender)
Desktop B  workspace.layout.changed
  → revision check drops echoes / stale
  → applyRemoteLayout: merge remote structure, keep local focus
New desktop C opens the workspace
  → workspace.layout.get.request pulls the current snapshot before C is allowed to push
```

## Why an opaque blob

The synced `layout` is the same normalized blob the layout store already persists to
AsyncStorage (`partialize` → `normalizeLayout`), which is fully self-contained: every pane
carries its tabs with their `target` (agentId / terminalId / file path / draft setup).

The protocol types `layout` as `z.record(z.unknown())` and the **daemon never parses the
split tree** — it stores, arbitrates by revision, and fans out the blob verbatim. The app
reconstructs runtime state with `normalizeLayout()`, which is robust to any external JSON
(bad tree → default, invalid tab → dropped). This keeps the protocol stable: future
layout-shape changes never touch it.

## Revision arbitration (last-write-wins)

Each `(serverId, workspaceId)` has a monotonically increasing revision. The daemon is the
authority: `applyPush` rejects a push whose revision is not strictly greater than the stored
one and returns the stored revision so the client can realign. Revision, not a timestamp,
avoids multi-device clock skew.

## Anti-loop (three guards)

All sync logic lives in one off-React module, `packages/app/src/stores/workspace-layout-sync.ts`,
so there are no defensive branches scattered through the store or screens.

1. **`applyingRemoteKeys`** — while a remote layout is being written into the store, that
   key's store change is not pushed back.
2. **Revision compare** — an incoming `changed` with `revision <= ours` is dropped (kills the
   echo of our own push).
3. **Stripped-blob dedupe** — the bridge remembers the last pushed focus-stripped blob; a pure
   focus change produces an identical stripped blob and is not pushed.

## Pull-before-push & the first-hydrate pass

Persisted tabs and tab groups are restored on reload (see
[agent-lifecycle.md](agent-lifecycle.md) "Startup tab restore"). The first
reconcile after agents hydrate may still auto-open missing running roots; pushing
that pass early could race a peer with a fuller layout.

Fix: **pull-before-push**. A workspace cannot push until `pullWorkspaceLayoutIfNeeded` has
fetched the daemon snapshot for it (`workspace-screen` calls this once the layout store has
hydrated). So a fresh client merges with the remote layout _before_ it is allowed to push.
The bridge also explicitly skips the store change where `initialRestoreDoneByWorkspace[key]`
flips true (first hydrate pass) as a belt-and-suspenders guard.

Consequence: **a remote layout takes precedence over a fresh client's incomplete local
snapshot.** That's the correct multi-device semantics.

## Known limitation

Closing a tab on one desktop is best-effort across devices: a peer's local `reconcileTabs`
auto-open can re-create the tab if the agent is still alive. Fully fixing this would require
syncing `hiddenAgentIdsByWorkspace` too; deferred. The structure sync (reorder / move / split)
is unaffected.

## Code map

- **Protocol** — `packages/protocol/src/messages.ts`: `WorkspaceLayoutEnvelopeSchema`,
  `workspace.layout.push.request`/`.response`, `workspace.layout.get.request`/`.response`,
  `workspace.layout.changed`, and the `workspaceLayoutSync` feature flag.
- **Daemon** — `workspace-layout-store.ts` (FileBacked, revision arbitration, persists to
  `$PASEO_HOME/projects/workspace-layouts.json`); `session.ts`
  `handleWorkspaceLayoutPushRequest`/`GetRequest`; `websocket-server.ts`
  `broadcastWorkspaceLayoutChanged` (excludes sender connection, filters mobile).
- **App** — `daemon-client.ts` `pushWorkspaceLayout`/`getWorkspaceLayout`;
  `workspace-layout-sync.ts` (the bridge); `workspace-layout-actions.ts`
  `stripWorkspaceLayoutFocus`/`mergeRemoteLayoutPreservingFocus`; `workspace-layout-store.ts`
  `applyRemoteLayout`.

## COMPAT cleanup

`COMPAT(workspaceLayoutSync)` — added v0.1.101, remove the gate after 2026-12-17. Grep
`rg "COMPAT\(workspaceLayoutSync"` for every site.
