---
title: Persistence and security boundaries
description: Understand authoritative files, event logs, indexes, secrets, protocol auth, and migration.
sidebar:
  order: 5
---

## Authoritative state

Projects and conversations live under `NERVE_HOME`. Canonical conversation records and durable protocol events use SQLite. Complete truncated tool results use private owner-scoped files beneath `<NERVE_HOME>/data/conversations/`, referenced by digest-bearing conversation records. Ephemeral notifications are not persisted or replayed.

`@nervekit/conversation-core` owns `data/nerve.sqlite`, using synchronous `node:sqlite`, WAL, foreign keys and synchronous transactions. Current configuration is separate from append-only history. `TOOL_CALL` and `INPUT_QUEUE` retain only unfinished work: settlement/delivery appends facts and deletes those rows transactionally. There are no separate agent/run tables, query-projection store or durable notification journal.

Replay reads conversation event sequences directly from SQLite; transcript/model context follow the selected history branch. Detail snapshots carry `lastSequence` so clients can subscribe from the snapshot boundary without scanning the entire durable tail. Live deltas stay ephemeral and do not trigger durable writes for every presentation frame. These are implementation choices, not measured throughput or latency guarantees.

Scoped permissions, capabilities, harness settings and agent profiles are JSON files. Project documents require exact-content trust where applicable. Launch definitions live at `<project>/.nerve/launches/definitions.json`; launch logs are files and instances are memory-only. Async Bash records and output references are durable, but process handles are local to the daemon and cannot be reconstructed after restart, so previously running records become `lost`.

## Filesystem safety

Server state mutations use same-directory temporary files, sync/close, atomic replacement, bounded native-host retries, and per-process serialization. Directory cleanup skips symlinks. POSIX mode bits harden Unix files but are not a Windows ACL boundary.

## Secrets and authentication

A local token authorizes HTTP and WebSocket access. Browser bootstrap converts query token to a Strict HttpOnly cookie. Provider/tool secrets use encrypted storage and selective migration/re-encryption where possible.

Schemas reject secret-like protocol metadata keys, but a broad error/details schema is not itself a redaction guarantee. Host boundaries must sanitize logs/errors before public transmission.

## Migration

Startup applies ordered, resumable home migrations before opening application storage and reports upgrade progress. The current baseline is release 0.34.1; older homes must first be opened with that release. Fresh homes initialize at the latest layout. Applied home steps are recorded in `manifest.json`; core SQL migrations have their own checksum ledger.

The conversation-core conversion also converts managed files and configuration, including legacy task definitions and scoped agent profiles. Malformed or conflicting profile conversion requires manual resolution rather than a permanent legacy loader. Rehearse migrations on a copied home, not live data. See the repository's [storage migration architecture](https://github.com/ThilinaTLM/nerve/blob/main/docs/architecture/migrations.md) for exact supported inputs and failure behavior.

## Electron boundary

Renderer sandboxing and narrow IPC reduce desktop attack surface. The renderer still intentionally talks to a powerful authenticated daemon; origin/token protection remains critical.

## Next steps

- [Protocol v1](/developers/protocol/)
- [Storage operations](/operations/storage-migration/)
