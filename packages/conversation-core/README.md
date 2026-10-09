# @nervekit/conversation-core

Portable conversation storage and agent runtime. A conversation owns current
configuration, branchable event history, queued inputs, unfinished tool calls
and async bash; delegated agents are child conversations.

The package depends on contracts, native, harness, skills and tools, never on
workbench-server, protocol or UI. Shared schemas live in
[`@nervekit/contracts/core`](../contracts/src/domains/core/).

## Layout

- `src/storage/`: synchronous SQLite, ordered SQL migrations and repositories.
- `src/context/`: selected event-tree projection to Pi messages and compaction.
- `src/tool-calls/`: supervision, interactions, execution, settlement and recovery.
- `src/inputs/`: merged input queue and fenced-command preparation.
- `src/async-bash/`: conversation-owned processes and agent `task_*` handlers.
- `src/runtime/`: runner, scheduler, status and recovery.
- `src/conversations/`: conversation/project/trust services and controls.
- `src/assets/`: managed file ownership and cleanup.
- `src/delegation/`: Explore and subagent handlers over child conversations.
- `src/ports.ts`: host capabilities; `src/core.ts`: facade and change feed.
- `src/index.ts`: curated package-root exports.

## Host boundary

`ModelPort` resolves models/credentials; `TurnResourcesPort` prepares the prompt
and available tools. `PermissionPort` evaluates policy and writes lasting rules.
`ToolHostPort` executes environment tools and declares replay safety.
`ProcessPort` starts/runs commands and attempts verified reattachment;
`ClockPort` optionally supplies time. The workbench server implements these ports.

The host opens `<NERVE_HOME>/data/core.sqlite` with `openCoreStorage`, provides an
asset root and ports, and constructs `ConversationCore`. SQLite transactions are
synchronous; JSON is schema-validated at repository boundaries.

## Facade

`ConversationCore` exposes project/trust services; conversation creation,
configuration, snapshots, selected history, sequence replay and tree selection;
input/interaction operations; pause/resume/stop/force-push/continue; compaction,
deletion and async bash. `registerCoreTool` installs portable tool handlers.

`subscribe` emits durable event appends plus ephemeral row/live changes. `start`
performs recovery and enables scheduling; `close` shuts down runtime work. The
host maps this feed to a transport; core itself owns no sockets or replay store
besides conversation events.

See [implementation overview](../../docs/architecture/conversation-core/README.md),
[storage architecture](../../docs/architecture/storage.md) and
[channels](../../docs/architecture/conversation-core/channels.md). Source and contracts
remain authoritative.
