---
title: Storage, cleanup, and migration
description: Back up Nerve state, inspect usage, prune safely, and understand legacy migration.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. It contains file-first authoritative state for projects, conversations, events, settings, provider/tool authentication, tasks, plans, logs, reports, and caches. SQLite is a rebuildable index/cache rather than the sole source of truth.

Electron's active Chromium profile is intentionally outside `NERVE_HOME`. Backing up only `~/.nerve` does not capture browser local/session storage or the active Electron profile.

## Inspect and clean up

Settings can estimate usage and run asynchronous cleanup for old conversations/logs, crash and Node diagnostic reports, event/tool-call compaction, reports, cache/temp data, and index rebuild. Cleanup skips symlinks during directory clearing and observes cancellation between targets; it cannot interrupt every target operation once started. Cleared disposable directories are recreated only when a producer next needs them.

Conversation pruning supports age and keep-latest boundaries. It skips running/awaiting agents and conversations with active tasks, then removes associated inactive task/tool/plan/log/index records.

## Legacy desktop migration

When local desktop mode finds an unversioned legacy home, it asks before changing it. Acceptance:

1. renames the whole directory to a timestamped backup such as `~/.nerve-bk-20260716-013229`;
2. initializes current versioned state;
3. imports validated settings, the custom provider/model catalog, and recoverable provider/tool credentials.

Projects, conversations, agents, tasks, plans, logs, run history, indexes, and daemon/session state remain only in the backup. Malformed settings/catalog abort and restore the original home. Credentials that cannot be decrypted cause reauthentication but do not destroy the backup.

Current storage migration 0008 removes retired in-home Electron profile data, obsolete empty handover/SQLite paths, pre-dense event archives, and committed internal migration archives. This one-time cleanup is intentionally irreversible and leaves the migration ledger and current authoritative state intact.

Timestamped whole-home backups such as `~/.nerve-bk-*` are different from internal migration archives and remain user-controlled.

:::danger
Nerve never deletes whole-home migration backups automatically and does not auto-reset malformed, unknown, or future versioned stores. Stop all Nerve processes before manual state operations.
:::

## Next steps

- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Data locations](/reference/data-formats/)
