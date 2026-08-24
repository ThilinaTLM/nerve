---
title: Storage, cleanup, and migration
description: Back up Nerve state, inspect usage, prune safely, and understand legacy migration.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. Canonical conversation records and durable events live in SQLite. Complete tool results that exceed the agent preview contract live under owner-scoped `payloads/` files referenced and verified by those records. The home also contains settings, provider/tool authentication, tasks, plans, logs, reports, and caches.

Electron's active Chromium profile is intentionally outside `NERVE_HOME`. Backing up only `~/.nerve` does not capture browser local/session storage or the active Electron profile.

Nerve upgrades storage through an append-only, checksum-bound migration ledger. Settings and JSON sidecar changes use canonical JSON migrations with atomic writes, rollback scope, and post-write verification. Release tests exercise a fully migrated prior settings shape before desktop bootstrap, and focused migration tests run on both Linux and Windows.

## Inspect and clean up

Settings can estimate usage and run asynchronous cleanup for old conversations/logs, crash and Node diagnostic reports, event/tool-call compaction, reports, cache/temp data, and index rebuild. Cleanup skips symlinks during directory clearing and observes cancellation between targets; it cannot interrupt every target operation once started. Cleared disposable directories are recreated only when a producer next needs them.

Conversation pruning supports age and keep-latest boundaries. It skips running/awaiting agents and conversations with active tasks, then removes associated inactive task/tool/plan/log/index records.

## Legacy-home migration

The workbench server owns one storage startup coordinator for desktop and headless startup. Local desktop mode supplies the confirmation dialog; headless startup applies the same automatic retained-backup policy. Remote desktop mode does not inspect or modify local `NERVE_HOME` state.

For an unversioned legacy home, the coordinator:

1. acquires a sibling startup lock and records a recoverable transaction journal;
2. renames the whole directory to a timestamped backup such as `~/.nerve-bk-20260716-013229`;
3. stages validated portable data and runs the normal migration ledger;
4. imports settings, custom provider/model definitions, and recoverable provider/tool credentials inside migration `0011` before the ledger commits.

Projects, conversations, agents, tasks, plans, logs, run history, indexes, and daemon/session state remain only in the backup. Malformed settings/catalog or ambiguous daemon metadata abort and restore the original home. Credentials that cannot be decrypted cause reauthentication but do not destroy the backup. An interrupted startup journal is recovered deterministically on the next launch rather than guessed.

Current storage migration 0008 removes retired in-home Electron profile data, obsolete empty handover/SQLite paths, pre-dense event archives, and committed internal migration archives. This one-time cleanup is intentionally irreversible and leaves the migration ledger and current authoritative state intact.

Timestamped whole-home backups such as `~/.nerve-bk-*` are different from internal migration archives and remain user-controlled.

:::danger
Nerve never deletes whole-home migration backups automatically and does not auto-reset malformed, unknown, or future versioned stores. Stop all Nerve processes before manual state operations.
:::

## Next steps

- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Data locations](/reference/data-formats/)
