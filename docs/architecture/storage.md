# Storage architecture

> **Status:** Current implementation. Owning schemas, repositories and host adapters are authoritative.

Nerve separates portable configuration, secrets, core relational data, managed files and disposable state. `NERVE_HOME` defaults to `~/.nerve`; development uses repo-local `data/storage-N`, not the live home.

## Home boundaries

[`storage-bootstrap/paths.ts`](../../packages/workbench-server/src/infrastructure/storage-bootstrap/paths.ts) owns home paths. The active layout includes:

```text
<NERVE_HOME>/
├── manifest.json
├── daemon.json
├── config/                 # daemon, harness, UI, providers, integrations, permissions
├── secrets/                # master.key, credentials.enc, daemon-token
├── data/
│   ├── nerve.sqlite
│   ├── conversations/      # owned tool files, bash output, permission overlays
│   ├── launches/           # workbench launch logs
│   ├── reports/
│   ├── images/
│   └── plans/
├── agent/                  # user-authored instructions and skills
├── tls/
├── tmp/
├── cache/
├── logs/
├── crashes/
└── backups/
```

Optional directories are created lazily. `manifest.json` identifies the home format; homes without it, or with an older layout, are rejected rather than imported. Electron's profile lives outside this boundary and needs separate test isolation.

- `config/` contains validated, atomically replaced human-readable settings.
- `secrets/` holds restricted encrypted credentials and authentication material; plaintext secret values do not belong in configuration or SQLite.
- `data/nerve.sqlite` owns projects, conversations, durable history and unfinished work.
- Managed conversation files and overlays are deleted with their owner. Core asset references are relative to `data/`.
- Launch definitions are project files at `.nerve/tasks/definitions.json`, not home database rows. Launch logs are files; instance identity/status/environment are in memory.
- `cache/` and `tmp/` are rebuildable; logs, crashes and backups have separate retention rules.

Homes from 0.34.1 are converted to this layout by the first [storage migration](migrations.md).

## Core SQLite

[`conversation-core/src/storage`](../../packages/conversation-core/src/storage/) owns the database, SQL migrations and repositories. It uses synchronous `node:sqlite` on the main thread, WAL, foreign keys and small indexed queries. Transactions use `BEGIN IMMEDIATE`; nested calls join the outer transaction and asynchronous callbacks are rejected. JSON is validated by [`contracts/core`](../../packages/contracts/src/domains/core/) at repository boundaries.

There are **11 tables**, covering foundation records, conversation state/history/work and scratch notes. See [data model](conversation-core/data-model.md) for the table relationships rather than a second schema here. The core has no agent/run tables, domain-document store, journal/checkpoints, projections, RPC receipt table or separate durable notification store.

Current configuration is separate from append-only event history. Every event links into the tree, even operational facts; selected-head history drives the transcript and model projection. Durable replay uses event sequence across all branches. Tool-call settlement and input delivery append facts and delete unfinished rows transactionally. See [events and context](conversation-core/events-and-context.md), [tool-call lifecycle](conversation-core/tool-call-lifecycle.md) and [input queue](conversation-core/input-queue.md).

`schema_migrations` records ordered SQL versions and checksums. Opening core storage applies missing steps transactionally and rejects unknown versions or changed checksums. This is not the old home-wide staging/promotion framework.

## Files and permissions

The host supplies an asset root at `<NERVE_HOME>/data`. New managed output lives under:

- `conversations/<conversationId>/tool-calls/<toolCallId>/...`
- `conversations/<conversationId>/bash/<bashId>/...`

`ASSET` tracks owner, logical path and file metadata; bytes stay outside SQLite. Imported assets can retain legacy relative locations. Reports, images and plans also remain file-based. Complete results and bounded model/transcript projections are distinct concerns; see [Tool-result projection](tool-result-projection.md).

[`core-host/permission.adapter.ts`](../../packages/workbench-server/src/core-host/permission.adapter.ts) composes the selected rule set with overlays at:

- User: `config/permissions.json`
- Project: `<project>/.nerve/config/permissions.json`
- Conversation: `data/conversations/<conversationId>/config/permissions.json`

Custom rule sets are JSON files under `config/rule-sets/`. Project overlays apply only when file-content trust matches their digest. “Always allow” writes the selected overlay; there is no grant table. See [permissions](permissions.md).

Tool and skill capabilities use the same three layers, also as files:

- User: `settings.tools` and `settings.skills` in user settings.
- Project: `<project>/.nerve/config/capabilities.json`, applied only when trusted for its exact content.
- Conversation: `data/conversations/<conversationId>/config/capabilities.json`; a missing file inherits everything.

See [capabilities](conversation-core/README.md#capabilities) for the override rules.

Prompt suggestions are Markdown files (built-in, `agent/suggestions/`, `<project>/.nerve/suggestions/`). Trust in a suggestion's JavaScript predicate is a `TRUSTED_RESOURCE` row for its exact content; enabled/disabled choices live in `config/prompt-suggestions.json`.

## In-memory state and restart

- Streaming text/thinking, argument drafts, tool progress and channel notices are ephemeral.
- Workbench file and git monitors, integration health and the latest maintenance operation live in service memory. Reconnect re-fetches snapshots; no workspace replay is persisted.
- Launch instances start empty after daemon restart; graceful shutdown cancels them. A crash may leave detached processes, intentionally without recovery.
- Async bash identity/status/output references are durable, but native process handles are instance-local. Failed verified reattachment marks running rows `lost`; effects are not blindly replayed.
- Execution slots and in-progress command preparation live in memory; after a restart, the unfinished tool-call and input rows drive recovery. Pause is stored and survives restarts. See [async bash and launches](conversation-core/async-bash-and-launches.md) and [channels](conversation-core/channels.md).

Stopping a conversation pauses it and cascades through descendants/async bash. Deletion stops work before removing files and rows; project deletion leaves project-authored files untouched.

## Migrations

See [storage migrations](migrations.md).
