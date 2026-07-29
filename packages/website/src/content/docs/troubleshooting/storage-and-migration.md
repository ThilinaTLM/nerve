---
title: Storage and migration problems
description: Respond safely to incompatible state, legacy migration, and cleanup failures.
sidebar:
  order: 7
---

## Incompatible state

Current state uses marker `nerve-workbench-state` version 2. Nerve does not automatically downgrade, reset malformed state, or open unknown/future versions. Stop all Nerve processes and preserve the complete directory before testing a fresh `NERVE_HOME`.

## Legacy history appears missing

The desktop's unversioned-home migration is selective. It restores validated settings, custom provider/model catalog, and recoverable credentials. Projects, conversations, agents, tasks, plans, logs, run history, SQLite, and daemon/session state remain in the timestamped backup by design.

Do not delete the backup. Reopen it only with a compatible old version in a fully isolated profile, or manually extract data after understanding the format.

## Credential import failed

Startup can continue with the complete backup intact and ask for authentication. This is nonfatal because credentials may be machine-bound or undecryptable. Reauthenticate in the new profile.

## Migration aborts

Malformed settings or catalog data cause rollback to the original legacy home. Read logs and fix/copy data rather than partially deleting migration markers.

## Cleanup appears stuck

Cleanup cancellation is observed between targets, not inside every operation. Search index replacement cannot be interrupted mid-target. Wait for the current target and inspect storage-operation status/logs.

:::danger
Never manually edit or remove live state while desktop/daemon processes are running. Prefer a complete copied profile and explicit `NERVE_HOME` override.
:::

## Next steps

- [Storage and migration guide](/operations/storage-migration/)
- [Data locations](/reference/data-formats/)
