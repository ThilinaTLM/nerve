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
│   ├── conversations/      # owned tool files, bash output, reports, config overlays
│   ├── launches/           # workbench launch logs
│   ├── images/
│   └── plans/
├── agent/                  # user-authored instructions, skills and suggestions
├── tls/
├── tmp/
├── cache/
├── logs/
├── crashes/
└── backups/
```

Optional directories are created lazily. `manifest.json` identifies the home format; homes without it, or with an older layout, are rejected rather than imported. Electron's profile lives outside this boundary and needs separate test isolation.

- `config/` contains validated, atomically replaced human-readable settings. Invalid runtime-owned documents are preserved while runtime uses in-memory defaults; explicit reset quarantines originals. See [settings recovery](migrations.md#runtime-owned-settings).
- `secrets/` holds restricted encrypted credentials and authentication material; plaintext secret values do not belong in configuration or SQLite.
- `data/nerve.sqlite` owns projects, conversations, durable history and unfinished work.
- Managed conversation files and overlays are deleted with their owner. Core asset references are relative to `data/`.
- [Launch definitions](launch-definitions.md) are project files at `.nerve/launches/definitions.json`, not home database rows. Their architecture owns the catalog schema, folder/order invariants, and project-file mutation boundary. Launch logs are files; instance identity/status/environment are in memory.
- `cache/` and `tmp/` are rebuildable; logs, crashes and backups have separate retention rules.

Homes from 0.34.1 are converted to this layout by the first [storage migration](migrations.md).

## Core SQLite

[`conversation-core/src/storage`](../../packages/conversation-core/src/storage/) owns the database, SQL migrations and repositories. It uses synchronous `node:sqlite` on the main thread, WAL, foreign keys and small indexed queries. Transactions use `BEGIN IMMEDIATE`; nested calls join the outer transaction and asynchronous callbacks are rejected. JSON is validated by [`contracts/core`](../../packages/contracts/src/domains/core/) at repository boundaries.

There are **11 tables**, covering foundation records, conversation state/history/work and scratch notes. See [data model](conversation-core/data-model.md) for the table relationships rather than a second schema here. The core has no agent/run tables, domain-document store, journal/checkpoints, projections, RPC receipt table or separate durable notification store.

Current configuration is separate from append-only event history. Every event links into the tree, even operational facts; selected-head history drives the transcript and model projection. Durable replay uses event sequence across all branches. Tool-call settlement and input delivery append facts and delete unfinished rows transactionally. See [events and context](conversation-core/events-and-context.md), [tool-call lifecycle](conversation-core/tool-call-lifecycle.md) and [input queue](conversation-core/input-queue.md).

`schema_migrations` records ordered SQL versions and checksums. Opening core storage applies missing steps transactionally and rejects unknown versions or changed checksums. This is not the old home-wide staging/promotion framework.

## Files and permissions

[Scoped configuration](configuration.md) defines the common user (`<NERVE_HOME>/config/`), project (`<project>/.nerve/config/`) and conversation (`<NERVE_HOME>/data/conversations/<id>/config/`) roots across tools, skill selections, profiles, permission overlays and compaction. Built-in defaults have no writable root. Domains retain separate documents and merge rules; SQLite conversation configuration remains an intentional exception. The same document defines shared path infrastructure, save guarantees and next-request freshness.

The host supplies an asset root at `<NERVE_HOME>/data`. New managed output lives under:

- `conversations/<conversationId>/tool-calls/<toolCallId>/...`
- `conversations/<conversationId>/bash/<bashId>/...`
- `conversations/<conversationId>/reports/<executionId>.md` (a sub-agent's full final response when it exceeded the notice cap)

`ASSET` tracks owner, logical path and file metadata; bytes stay outside SQLite. Imported assets can retain legacy relative locations. Images and plans also remain file-based. Complete results and bounded model/transcript projections are distinct concerns; see [Tool-result projection](tool-result-projection.md).

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

Compaction settings have the same layers in `harness.json`: user `config/harness.json`, project `<project>/.nerve/config/harness.json`, and `data/conversations/<conversationId>/config/harness.json`, which holds only conversation-scoped settings and replaces the inherited compaction value as a whole. See [delegation](conversation-core/delegation.md#compaction-settings).

Prompt suggestions are Markdown files (built-in, `agent/suggestions/`, `<project>/.nerve/suggestions/`). Trust in a suggestion's JavaScript predicate is a `TRUSTED_RESOURCE` row for its exact content; enabled/disabled choices live in `config/prompt-suggestions.json`.

Agent profiles use one versioned JSON document per writable scope as described in the [customization reference](agent-profiles.md): user `config/agent-profiles.json`, project `<project>/.nerve/config/agent-profiles.json`, and conversation `data/conversations/<id>/config/agent-profiles.json`. Each contains sparse named overrides including enabled state and instructions; there are no separate Markdown definitions or enablement preferences. Built-in → user → project → conversation resolution retains explicit values until reset; copy-to-scope materializes effective fields. Project document trust is bound to exact content through existing trust storage, with no new database tables or columns. Entry edits, toggles and resets in an untrusted imported document do not grant whole-document trust or activate untouched entries; explicit whole-document trust is required. Nerve-authored updates may automatically trust missing/new documents or updates to previously exact-trusted documents only. Profile-document trust does not establish independent trust for skill content; skill loadability retains existing resource-loader security semantics, with no new skill trust system or database gate. Conversation documents are deleted with their owner. Lead profiles resolve instructions, capability deltas and Locks each turn; Set values apply on switching. Sub-agent profiles configure new children only; existing children use their own configuration. See [delegation](conversation-core/delegation.md#profiles). Conversion covers user resources and registered projects, not all directories on disk. Conversion preserves damaged or conflicting sources rather than guessing capability intent; recovery and conversion limits are step-specific. Later-opened unregistered old projects need canonical `.nerve/config/agent-profiles.json`; there is no runtime legacy loader. See [conversion limits](../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/README.md). Dev homes with an earlier draft of step 0001 already applied need a baseline rebuild/copy; an extension does not rerun an applied ledger entry (see [migration limitation](../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/README.md)).

## In-memory state and restart

- Streaming text/thinking, argument drafts, tool progress and channel notices are ephemeral.
- Workbench file and git monitors, integration health and the latest maintenance operation live in service memory. Reconnect re-fetches snapshots; no workspace replay is persisted.
- Launch instances start empty after daemon restart; graceful shutdown cancels them. A crash may leave detached processes, intentionally without recovery.
- Async bash identity/status/output references are durable, but native process handles are instance-local. The workbench adapter cannot reconstruct those handles after daemon restart, so previously running rows become `lost`; commands are not replayed.
- Execution slots and in-progress command preparation live in memory; after a restart, the unfinished tool-call and input rows drive recovery. Pause is stored and survives restarts. See [async bash and launches](conversation-core/async-bash-and-launches.md) and [channels](conversation-core/channels.md).

Stopping a conversation pauses it and cascades through descendants/async bash. Deletion stops work before removing files and rows; project deletion leaves project-authored files untouched.

## Migrations

See [storage migrations](migrations.md).
