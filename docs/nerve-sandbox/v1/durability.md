# Sandbox durability

Sandbox state is file-first under `/state`. `/state/VERSION` is `{ "format": "nerve-sandbox-agent-state", "version": 4, ... }`.

The layout contains effective/sanitized config, controller session/cursors/connectivity, protected credentials and secure launch environments, secret/setup status, persistent idempotency, event outbox and ACK state, context/skills metadata, boot attempts, dependency caches, and per-conversation/agent/run journals and checkpoints.

Accepted durable transitions are persisted before publication. The outbox is replayed until processed ACK. Recovery validates the marker, takes the state lock, restores journals/checkpoints/task state, reconciles incomplete work, reloads setup and credentials, then reconnects with the exact sandbox cursor. Shared `RunCoordinator` and `TaskService` remain lifecycle authorities after recovery.

The manager persists its own lifecycle stream and ingested sandbox events in PostgreSQL. UI recovery loads a cursor-bearing snapshot and installs it before replay. Manager and selected-sandbox cursors are independent.

There are no migrations or fallback readers for disposable pre-v1 layouts. Reset requirements are in [implementation status](implementation-status.md).
