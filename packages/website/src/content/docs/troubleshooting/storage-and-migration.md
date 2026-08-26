---
title: Storage and migration problems
description: Respond safely to incompatible state, legacy migration, and cleanup failures.
sidebar:
  order: 7
---

## Incompatible state

Current state uses `manifest.json` with format `nerve-home`, version `1`. Nerve does not automatically downgrade, reset malformed state, or open unknown/future versions. The explicit legacy importer accepts released Nerve 0.26 homes only when their checksummed ledger ends at `0012-remove-workers`; a modified or partial ledger is rejected. Stop all Nerve processes and preserve the complete directory before testing a fresh `NERVE_HOME`.

## Legacy history appears missing

The server-owned v2-home migration is selective; desktop only supplies confirmation and progress UI. A released post-0012 home is converted directly to current storage without first running migration 0013. Validated settings, the custom provider/model catalog, recognized credentials, projects and agents needed by retained conversations, semantic conversation/run history, referenced payloads, and plans are imported. Logs, caches, task process state/logs, daemon metadata, TLS identity, and project allow trust remain only in the timestamped backup by design.

Do not delete the backup. It contains the unchanged original post-0012 layout and is the recovery source if imported data needs investigation.

## Credential import failed

Startup can continue with the complete backup intact and ask for authentication. This is nonfatal because credentials may be machine-bound or undecryptable. Reauthenticate in the new profile.

## Migration aborts

Malformed settings, catalog data, daemon metadata, or startup journals fail closed. Before commit, failures restore the original legacy home; interrupted journals are recovered on the next startup. Read the reported paths and fix/copy data rather than deleting VERSION, ledger, lock, or journal files.

## Retired internal archives disappeared

Storage migration 0008 permanently removes committed internal migration archives, pre-dense event archives, the retired in-home Electron profile, and other obsolete paths. It does not remove timestamped whole-home `~/.nerve-bk-*` backups or current project/conversation state.

## Cleanup appears stuck

Cleanup cancellation is observed between targets, not inside every operation. Search index replacement cannot be interrupted mid-target. Wait for the current target and inspect storage-operation status/logs.

:::danger
Never manually edit or remove live state while desktop/daemon processes are running. Prefer a complete copied profile and explicit `NERVE_HOME` override.
:::

## Next steps

- [Storage and migration guide](/operations/storage-migration/)
- [Data locations](/reference/data-formats/)
