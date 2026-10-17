# Launch definitions

This document is the architectural contract for project-owned launch definitions: their portable schema, folder hierarchy, manual ordering, mutation boundary, and relationship to running processes. Shared contracts and implementation must preserve these invariants.

A **definition** is a saved command configuration. A **folder** organizes definitions and other folders. A **run** is an execution of a definition or an ad-hoc command. Organization and execution are separate concerns.

For agent-facing launch selection, permissions, execution, and output behavior, see [async bash and launches](conversation-core/async-bash-and-launches.md). For storage boundaries, see [storage architecture](storage.md).

## Ownership

| Owner                                                                                               | Responsibility                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Contracts](../../packages/contracts/src/domains/launch-definitions/)                               | Persisted and runtime schemas, typed entry references, request/response and event contracts.                       |
| [Server launch-definitions domain](../../packages/workbench-server/src/domains/launch-definitions/) | Project ownership, document loading, hierarchy validation, revision checks, structural mutations, and persistence. |
| [Server launches domain](../../packages/workbench-server/src/domains/launches/)                     | Process execution, single/concurrent policy, readiness, cancellation, and run output.                              |
| [App launches feature](../../packages/workbench-app/src/lib/features/launches/)                     | Project catalog cache, tree projection, activity counts, and organization actions.                                 |
| App composition                                                                                     | Active-project selection, feature registration, and wiring activity into shell badges.                             |
| Protocol                                                                                            | Transport, RPC, events, and reconnect mechanics; no launch-folder lifecycle rules.                                 |

Agents can operate launches through the launch tool, but cannot create, rename, move, or delete definitions or folders through that tool. User management APIs remain distinct from execution capabilities.

## Project catalog and persistence

Each project has one authoritative catalog at:

```text
<project>/.nerve/launches/definitions.json
```

The catalog is portable project configuration, not a SQLite entity or a document under `NERVE_HOME`. It has no user/conversation inheritance. Folders and ordering are shared with the project, not personal workspace layout.

The catalog uses one versioned JSON document containing flat `folders` and `definitions` collections. There is no separate authoritative layout tree or layout sidecar. A backup or coordination lock is not a second configuration source.

Missing files represent an empty catalog. Invalid files do not: report their path and validation failure without replacing them with defaults. Unsupported versions are preserved and rejected rather than partially decoded or rewritten.

### Version 2 schema

The following describes the logical persisted model. The contracts package owns its executable validators and serialization.

| Record     | Fields                                                                                                                | Meaning                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Catalog    | `version: 2`, `folders`, `definitions`                                                                                | One complete project document. Both collections are required.                                                          |
| Folder     | `id`, `label`, `parentFolderId`, `order`                                                                              | Stable `launchfolder_` ID, nonblank display name, nullable parent folder ID, and nonnegative integer sibling position. |
| Definition | `id`, `scope`, `label?`, `command`, `cwd?`, `port?`, `runPolicy`, `createdAt`, `updatedAt`, `parentFolderId`, `order` | Execution configuration plus its placement.                                                                            |

Definition execution fields retain their own contract:

- `id` is a stable `launchdef_` identity, independent of its label, command, folder, or position.
- Persisted `scope` is `{ "kind": "project" }`. Runtime scope adds the owning `projectId`, derived from the enclosing project rather than persisted from a local installation.
- `label` is optional. Display falls back to the command. Missing or duplicate configuration labels are valid.
- `command` is a nonblank command; folder operations do not rewrite it.
- `cwd` is optional and follows launch working-directory resolution, not folder ancestry.
- `port` is an optional TCP port in `1..65535`.
- `runPolicy` is `single` or `concurrent`.
- `createdAt` and `updatedAt` are definition timestamps. A placement-only change does not change execution configuration or its timestamps.

Both record kinds use the same `parentFolderId` placement field; folders use `label` for their display name, as definitions do. `parentFolderId: null` means the implicit root. Root has no record or generated ID. Neither runtime project identity, activity counts, run records, nor expanded/collapsed state is stored in this document.

Example, including mixed root-level folders and configurations:

```json
{
  "version": 2,
  "folders": [
    {
      "id": "launchfolder_dev",
      "label": "Dev servers",
      "parentFolderId": null,
      "order": 0
    }
  ],
  "definitions": [
    {
      "id": "launchdef_api",
      "scope": { "kind": "project" },
      "label": "API",
      "command": "pnpm dev:api",
      "runPolicy": "single",
      "createdAt": "2026-10-17T00:00:00.000Z",
      "updatedAt": "2026-10-17T00:00:00.000Z",
      "parentFolderId": "launchfolder_dev",
      "order": 0
    },
    {
      "id": "launchdef_login",
      "scope": { "kind": "project" },
      "command": "aws sso login",
      "runPolicy": "single",
      "createdAt": "2026-10-17T00:00:00.000Z",
      "updatedAt": "2026-10-17T00:00:00.000Z",
      "parentFolderId": null,
      "order": 1
    }
  ]
}
```

### Hierarchy and ordering invariants

- IDs are unique within a project. References are typed as folder or definition references; labels and rendered paths are never identity.
- Every non-null parent exists and is a folder in the same catalog.
- A folder cannot parent itself or be moved beneath a descendant. There are no cycles.
- Every record has exactly one parent and position. Definitions are leaves; empty folders are valid.
- For each parent, combine its folders and definitions into **one** sibling list. Their orders are exactly `0..n-1`, with no duplicates or gaps. The order of the two top-level JSON arrays is not a second placement authority.
- Folder names are stored trimmed. Their uniqueness key is JavaScript `label.trim().toLowerCase()`, independent of the user's locale; no additional Unicode normalization or full case folding is applied. Sibling folder names are unique; the same name in different parents is valid. Definition labels may duplicate one another or a folder name.
- Create, rename, and move all enforce folder-name uniqueness at the destination. A conflict is rejected, not silently renamed.
- Persisted manual order is authoritative. Alphabetical sorting and execution recency never reposition items.

The server validates the complete catalog on load and before persistence. Invalid references, names, or positions are diagnosed, not silently repaired. Writers normalize affected sibling positions as part of a valid mutation; legacy conversion has its own explicit rules below.

## Commands and mutation boundary

Read operations return a complete runtime catalog and an opaque revision token. All user management mutations include the project ID and the revision against which the user acted.

| Operation         | Semantics                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Create folder     | Add a named folder at a destination parent and optional insertion anchor.                                                   |
| Rename folder     | Change its label without changing identity, placement, descendants, or runs.                                                |
| Delete folder     | Delete an empty folder only. A nonempty folder must first be emptied; there is no implicit recursive deletion or promotion. |
| Create definition | Create execution configuration and placement in one document mutation.                                                      |
| Update definition | Change execution configuration without unintentionally resetting placement.                                                 |
| Delete definition | Remove its catalog record and normalize siblings; do not stop or erase linked runs.                                         |
| Move entry        | Reparent and/or reorder either kind of entry atomically.                                                                    |

Moves express intent rather than client-assigned position numbers:

```ts
{
  projectId,
  expectedRevision,
  entry: { kind: "folder" | "definition", id },
  destinationFolderId: string | null,
  beforeSibling: { kind: "folder" | "definition", id } | null
}
```

A null anchor appends to the destination. An anchor must exist under that destination and cannot be the moved item. Same-parent reordering and cross-folder moves use the same operation. Moving a folder changes its placement only; descendant records remain attached. A true no-op need not write or publish a change.

Drag-and-drop, “Move to,” and menu/keyboard reordering produce this same command. A drop preview identifies the destination parent and insertion position; the server remains authoritative if the catalog changes during a drag. Stale intent is rejected and refreshed, not silently replayed elsewhere.

### Write transaction and concurrency

The transaction boundary is the canonical catalog path, not a panel instance, client connection, project registration alias, or `NERVE_HOME`.

1. Acquire exclusive project-catalog write coordination across cooperating Nerve processes. Aliases to the same project directory must share that boundary.
2. Read and validate the authoritative document while holding coordination.
3. Check `expectedRevision`; reject a stale token without writing.
4. Apply the command, validate hierarchy/name invariants, and normalize affected sibling positions.
5. Atomically replace the document using restricted file permissions and the shared durable-write infrastructure.
6. Make the committed snapshot visible, release write coordination, and publish catalog invalidation. A failed publication does not turn a committed file write into an uncommitted mutation: acknowledge the committed result and log/retry notification failure rather than inviting a duplicate retry of the command.

All catalog writers, including definition edits and legacy conversion, use this boundary. A process-local queue is useful but does not substitute for cross-process coordination. If exclusive coordination cannot be established, the mutation fails rather than falling back to an unprotected write. Lock ownership and crash recovery must not allow a live writer's lock to be stolen.

The revision is a SHA-256 digest of the validated persisted v2 logical catalog, excluding derived runtime fields. Canonicalization sorts object keys and sorts the top-level record collections by ID; sibling placement remains encoded by `parentFolderId` and `order`. It retains all persisted fields and resolved schema defaults, including the version. Whitespace, object-key order, and top-level record-array order do not affect the token. It is an equality token, not a timestamp or a sortable event sequence. Same-content no-ops may retain the same revision.

For v1, validate and convert to the root-only v2 logical model before computing the token with the same algorithm. Under write coordination, reread and decode the source, then compare its logical digest to `expectedRevision`. Formatting-only edits do not cause a revision conflict. The exact source bytes read under coordination, not bytes from an earlier client read, are the conversion backup; byte identity is checked separately when deciding whether an existing backup can be reused.

Atomic replacement prevents partial files; the exclusive transaction prevents lost read–modify–write updates between cooperating writers. It does not make the project file and run state one cross-domain transaction. Save-from-run association retains its separate failure/compensation behavior; any compensating catalog mutation also uses the catalog transaction boundary.

External tools and editors do not participate in Nerve's coordination. Direct edits or Git replacements require quiescent catalog writes and explicit reload/revalidation. A semantic external change invalidates an earlier token. No protection against an uncooperative editor racing between a check and replacement is claimed. Network/distributed filesystems are not given stronger coordination guarantees than their locking and atomic-replacement primitives provide.

## Cache, events, and reconnect

Catalog state is cached by project in the launches feature, with application-lifetime subscriptions. Its correctness must not depend on whether a Launches panel is mounted.

Every committed semantic mutation invalidates the project catalog, including folder-only rename, movement, ordering, and deletion. Invalidation identifies the project and committed revision. Clients fetch a complete snapshot rather than independently reconstructing hierarchy from per-row event patches.

- Subscribe before the initial read, and track invalidations that arrive while it is in flight.
- Use a per-project request/invalidation generation. A response started before a newer invalidation cannot overwrite the cache; invalidate and fetch again, coalescing requests where appropriate.
- Do not order opaque revisions. Mutation responses, event notifications, and fetch responses can arrive in different orders.
- Mutation responses acknowledge a commit; they do not directly replace the catalog cache. Invalidate and fetch after success or a revision conflict, applying the same generation rules as event-driven reads. A late response therefore cannot install its older snapshot over a newer one; an extra refetch is safe when ordering is unknowable. Do not automatically replay a rejected structural mutation.
- Revalidate on project activation, explicit refresh, and reconnect for demanded projects. These reads recover from missed notifications, including publication failures. Events are a freshness aid, not durable catalog storage or a workspace replay log; delivery while disconnected is not guaranteed.
- Errors retain a distinguishable last-known snapshot where available; an invalid/unavailable catalog must not masquerade as an empty authoritative one. Disable structural actions until a valid revision is available.

Current-project activity remains available to shell badges without mounting the tree. Panel, toolbar, context menu, and mobile actions share feature commands rather than implementing their own persistence paths.

## Runtime identity and execution isolation

Runtime definition identity is `(projectId, definitionId)`. Folder identity is likewise project-qualified. Starting a definition, enforcing `single`, tracking pending starts, joining runs to definitions, caching mutations, and selecting/restoring definition output tabs all use project-qualified identity.

Project copies can retain the same portable IDs. Resolve an action in its specified project; never scan all projects for the first matching bare definition ID. Project ownership comes from `projectId`, not whether a run's cwd lies beneath the project directory. A project-owned configuration may intentionally execute with an external cwd.

Folders never supply inherited commands, environments, cwd, ports, readiness, permissions, or run policies. There is no implicit “run folder” operation. Creating, renaming, reordering, moving, or deleting organizational records does not start, restart, stop, or mutate processes.

A definition edit affects subsequent execution. Existing runs retain their executed command, working directory, launch identity, output, and historical metadata. Run status/output uses the run snapshot; the configuration row can display the saved definition's current label. Folder paths are presentation, not permission targets or agent-facing launch selectors. Name-based selection and ambiguity handling remain governed by the launch tool contract.

### Activity projection

For the current project, a saved definition is active when at least one owned run has status `starting`, `running`, `ready`, or `stopping`.

- The tab badge counts distinct active saved definitions, not processes or historical runs. It is hidden at zero and has an accessible activity description.
- A folder badge counts distinct active definitions in its full descendant subtree, including collapsed folders.
- Concurrent runs of one definition count once. Moving an active definition changes ancestor counts immediately but leaves the project total unchanged.
- Activity is derived from the catalog and run state, never persisted as catalog fields.

Unsaved runs and runs whose definition no longer exists appear in the standalone runs projection. This is determined by whether a definition resolves in the owning project, not merely by the absence of `definitionId`.

Deleting a definition keeps its linked run identities and references intact. Active orphaned runs retain normal run controls and output; finished runs follow normal runtime retention. Neither kind counts as a saved configuration. The shell's separate active-run signal keeps execution discoverable even when the configuration count is zero. A catalog load failure alone is not evidence that a definition was deleted.

Launch instance recovery and retention are execution-domain concerns. Folder persistence adds no database run records and no process recovery after daemon restart.

## Version conversion and recovery

Catalog format conversion is project-local and independent of the home database schema and home migration ledger. It applies when a project is opened, including projects not registered during a home upgrade.

A valid version-1 catalog decodes into version 2 in memory:

- No folders are created automatically.
- Every definition becomes a root child with `order` equal to its existing definitions-array index.
- IDs, timestamps, optional/duplicate labels, and execution fields are preserved. Existing schema defaults are applied without changing execution intent.
- Runtime scope is derived from the enclosing project. Local installation IDs are not embedded in portable output.
- Runs, logs, restart chains, and execution state are not rewritten.

File-array order is the deterministic initial manual order; it is not reconstructed from installation-local execution recency. Both the in-memory projection and persisted conversion use the same order.

Reads do not rewrite v1 files. The first successful semantic mutation writes only v2 under the normal transaction boundary. Before replacement, preserve an exact, restricted-permission copy of the source v1 bytes at `definitions.v1.backup.json` in the same directory. Never overwrite an existing backup. An existing byte-identical backup can be reused; a different or unreadable backup is a recovery conflict. Backup failure blocks conversion. The backup and replacement are not one filesystem transaction. Authority after interruption is determined by `definitions.json`: a valid v1 file remains a v1 source; a valid v2 file is the committed catalog even if the process failed before acknowledging success. A completed backup can remain alongside either. If the authoritative file is missing or invalid after an attempted conversion, report a recovery error rather than treating the backup as live configuration; retain enough evidence to distinguish this from a project with no catalog. The atomic-write infrastructure owns replacement crash guarantees. A caller that lost its acknowledgement rereads the catalog instead of blindly repeating creation or another structural command.

The backup is a recovery artifact, never an automatic read fallback. Invalid v1 input, duplicate IDs, malformed input, and unknown versions fail without changing the source or minting replacement identities. Do not silently merge a backup with the live catalog.

Restoring v1 requires quiescent writers, preserving any newer v2 edits separately, and an explicit restore. Older binaries reject v2 rather than discarding organization metadata. Restoring the pre-conversion backup does not preserve edits made after conversion.

## Architectural verification

Owning-layer tests establish these guarantees:

- Lossless v1 conversion, including missing/duplicate labels, file order, backup conflicts, failed writes, and unsupported versions.
- Mixed sibling ordering, cycle/reference/name validation, empty-folder deletion, source/destination normalization, and subtree moves.
- Revision conflicts and exclusive write coordination, including two cooperating processes addressing the same project through aliases.
- Project-qualified starts, pending/single-run enforcement, output-tab identity, and projects sharing portable definition IDs.
- Distinct activity counts, external-cwd ownership, moves while running, and orphan visibility after definition deletion.
- Cache freshness with unmounted panels, invalidations during fetch, reconnect, publication failure recovery, and stale mutation responses.
- Accessible create/rename actions and non-drag alternatives producing the same semantic move commands.

These invariants belong at their owning layer; UI cosmetics do not duplicate persistence or execution tests.
