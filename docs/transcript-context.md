# Transcript Context

“Add transcripts” lets a New Agent draft use one or more existing Paseo agent
conversations as prompt context. It creates a new provider session; it does not
resume, merge, or mutate any source session. Import Session remains the path for
resuming provider-native state.

The feature is shared Expo UI and is available in Electron, browser web, iOS,
and Android. Compact layouts use the isolated bottom-sheet presentation;
non-compact native and web layouts use the adaptive modal presentation. Do not
add a desktop-only gate around this flow.

## Ownership and data flow

The destination New Agent draft owns each selected transcript as an immutable
snapshot:

```text
source daemon A ── bounded export ──┐
source daemon B ── bounded export ──┼─> app draft store
source daemon C ── bounded export ──┘         │
                                              │ create agent
                                              v
                                      destination daemon D
```

1. The app discovers eligible top-level Paseo agents through agent history on
   connected hosts.
2. The source daemon curates and bounds the authoritative timeline through the
   point of capture.
3. The app persists the returned text and capture metadata on the destination
   draft. There is no daemon-to-daemon connection.
4. Creating the agent sends each snapshot as an ordinary `chat_history` text
   attachment before the new user instruction.
5. A successful create clears the draft-owned copies. A failed create keeps
   them for retry.

Once export succeeds, source-host disconnection or source-session changes do
not change the snapshot. Re-adding the same `(sourceServerId, sourceAgentId)`
refreshes it in place. See [data-model.md](data-model.md#draft-store) for the
persisted shape.

V1 keeps the bounded transcript text inline in the versioned draft record. The
draft persistence writer is throttled, and transcript equality checks avoid
serializing the body during ordinary text edits, but the checkpoint still
contains the inline text. Do not raise the 384 KiB aggregate limit without
moving bodies to blob-backed attachment storage and measuring native typing and
reload behavior.

## Source discovery and identity

The picker orders a source into its most specific eligible group:

1. This workspace: exact `(serverId, workspaceId)` equality.
2. Other workspaces in this project: exact `(serverId, projectKey)` equality.
3. Same Git project: equal normalized remote host, optional non-default port,
   and path.

Project IDs, workspace IDs, and filesystem paths are daemon-local and must
never establish cross-host repository identity. Remote matching uses
`parseGitRemoteLocation()` so SSH and HTTPS forms such as
`git@github.com:getpaseo/paseo.git` and `https://github.com/getpaseo/paseo`
match. A missing remote produces no cross-host match; Paseo does not guess from
folder names. Custom forge ports remain part of the identity so, for example,
`git.example:8443/org/repo` is not conflated with `git.example/org/repo`.

V1 includes active, idle, closed, failed, and running top-level Paseo agents. A
running source is labelled as captured while running. Export reads only the
timeline already retained by the daemon and never wakes or creates a provider
runtime. After a daemon restart, a closed source may therefore need to be
opened once before it can be exported. Archived sources are excluded because
production hosts do not yet retain an independently readable durable timeline
after archive. Provider-owned subagent timelines and provider-native sessions
that Paseo has never imported are also excluded.

The picker warns when the destination host is disconnected or when a connected
host fails the history request that the picker actually sent. It does not warn
for every unrelated disconnected record in the global host registry: that
record may be a deliberately offline machine or a stale daemon identity, and
without history Paseo cannot establish that it contains the same repository.
A connected old daemon may list sources, but its rows remain disabled until
`server_info.features.agentTranscriptExport` is true. There is no legacy-RPC
fallback.

## Export and privacy boundary

The source daemon owns curation. The app must not parse rendered assistant text
or reconstruct context from its local timeline replica.

`agent.transcript.export.request` / `.response` is the bounded RPC. The request
contains `agentId`, optional `maxBytes`, and `requestId`; the response returns a
plain-text attachment, retained/total entry counts, UTF-8 byte count,
truncation state, capture cursor, and a nullable error string. The total count
is null when the bounded source scan does not reach the beginning of the
timeline.

Portable transcript bodies contain:

- user messages;
- assistant messages;
- Paseo-owned tool kind markers such as `[Shell]`, `[Search]`, or `[Tool]`.

They deliberately exclude:

- private reasoning;
- raw tool input, including shell commands, search queries, and fetched URLs;
- tool summaries that may echo those inputs;
- provider-supplied tool names and subagent type labels;
- provider subagent logs and raw tool payloads.

User and assistant prose may itself contain sensitive information. Adding a
transcript is an explicit transfer to the destination agent/provider. The
snapshot also includes source title and directory metadata when they fit, and
the draft stores human-readable workspace and host labels for provenance. Do
not log transcript bodies; metrics may record counts, sizes, durations,
truncation, and errors only.

## Limits and truncation

The initial limits are centralized constants, not protocol promises:

| Limit                                          |   Value |
| ---------------------------------------------- | ------: |
| Transcripts per draft                          |       5 |
| Bytes per transcript                           | 128 KiB |
| Bytes across transcript snapshots in one draft | 384 KiB |
| Simultaneous source exports                    |       2 |
| Timeline rows scanned per source               |  25,000 |

The daemon first takes a bounded recent timeline window, then preserves the
newest contiguous suffix of whole curated entries that fits the byte limit. It
never cuts an entry in half and always retains the chat-history wrapper. When
the source window has older rows, `totalItemCount` is null and `truncated` is
true rather than reporting an invented total. The app applies aggregate
admission in two passes: size-reducing refreshes first, then additions and
size-increasing refreshes in selection order. This prevents click order from
rejecting a set that fits after a refresh shrinks an existing snapshot.

Existing Fork context in the draft counts toward the same item and aggregate
limits. Source-aware merging sends only one snapshot for a source and prevents
a removed Fork snapshot from reappearing through the transient attachment
scope.

## What is not transferred

A transcript carries conversation context only. It does not copy:

- files, uncommitted changes, commits, branches, or worktrees;
- terminals, permissions, tool state, environment variables, or credentials;
- provider session identity, reasoning state, or context-window accounting;
- source-agent lifecycle or a live link back to the source.

Use Git or another explicit artifact path when the destination also needs code
state.

## Implementation map

- Protocol schemas and capability: `packages/protocol/src/messages.ts`
- Source export handler: `packages/server/src/server/session.ts`
- Privacy curation and byte bounding:
  `packages/server/src/server/agent/activity-curator.ts`
- Client RPC: `packages/client/src/daemon-client.ts`
- Discovery/grouping/limits:
  `packages/app/src/components/add-transcripts-sheet-view-model.ts`
- Cross-platform picker: `packages/app/src/components/add-transcripts-sheet.tsx`
- Draft persistence: `packages/app/src/stores/draft-store/`
- New Agent integration: `packages/app/src/composer/draft/workspace-tab.tsx`

## Verification matrix

Pure tests cover remote normalization, grouping, archive exclusion, reducer
transitions, concurrency, aggregate admission, curation privacy, byte bounding,
protocol parsing, and draft migration. The Playwright trajectory in
`packages/app/e2e/add-transcripts.spec.ts` uses a real daemon and verifies
selection, export, preview, reload persistence, and create submission. The
prepared-draft Maestro flow in
`packages/app/maestro/add-transcripts-ready-draft.yaml` exercises the shared
iOS/Android picker and preview by stable test IDs.

For UI changes, capture the platform evidence required by `CONTRIBUTING.md` and
state explicitly which of Electron, browser web, iOS, and Android were actually
run. A shared bundle/typecheck is not a substitute for native-device QA.
