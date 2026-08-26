---
title: Storage, cleanup, and migration
description: Back up Nerve state, inspect usage, prune safely, and migrate the preceding home format.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. A current home is identified by `manifest.json` with format `nerve-home`, version `1`. Portable configuration lives in six versioned files under `config/`, credentials are encrypted under `secrets/`, canonical conversation state lives in `data/nerve.sqlite`, and managed files use logical home-relative references.

Electron's active Chromium profile remains outside `NERVE_HOME`. A whole-home backup therefore excludes browser session and device-local profile state by design.

## Inspect and clean up

Settings reports readable files across the complete Nerve home, including canonical data, payloads, runtime state, diagnostics, migrations, and backups. It can run asynchronous cleanup for old conversations and diagnostics, event compaction, reports, non-query cache/temp data, and the rebuildable query cache. Rebuilding the query cache replaces files under `cache/query-cache.sqlite`; it never modifies the authoritative `data/nerve.sqlite`. Migrations and backups are visible in usage but are not cleanup targets. Cleanup skips symlinks and observes cancellation between targets.

Conversation pruning skips running or awaiting agents and conversations with active tasks before removing associated inactive records and managed files.

## Legacy v2 migration

Ordinary startup never guesses or repairs an unknown home. The sole import path is an explicit offline migration from the immediately preceding marker:

```json
{
  "format": "nerve-workbench-state",
  "version": 2
}
```

Local desktop mode detects this format and asks for confirmation. The supported released source is Nerve 0.26 with its checksummed migration ledger ending at `0012-remove-workers`. It migrates directly to `nerve-home` v1—do **not** install or run `0013-canonical-storage` first. Canonical-v3 v2 homes produced by later development builds are accepted only as a compatibility source. Remote desktop mode does not inspect local `NERVE_HOME`. Unknown, malformed, partial, checksum-modified, and newer layouts remain untouched.

Before migration, quit every Nerve process that uses the source home. Migration then:

1. acquires a sibling startup lock and recoverable journal;
2. creates an isolated v1 staging home and reads the released post-0012 source without modifying it (canonical-v3 compatibility sources use a consistent read-only SQLite snapshot);
3. converts post-0012 JSON and JSONL records directly into the current v1 schema, importing and validating configuration, recognized encrypted credentials, projects and agents needed by conversations, conversation records and durable events, referenced payloads, and plans;
4. rewrites managed files to logical v1 references and records their metadata;
5. validates the complete v1 home before any source rename;
6. atomically promotes the staged home and retains the complete old tree under `backups/legacy-v2-<timestamp>/`.

The live v1 home does **not** import logs, crashes, cache, temporary data, task process state or logs, daemon discovery metadata, TLS identity, or generated runtime diagnostics. Project allow permissions require explicit digest-bound approval again. User denies remain authoritative.

Credentials are decrypted only in memory and re-encrypted with the new home key. Secret values are never written to configuration, SQLite, logs, or migration reports. Task launch secrets are not imported.

If validation fails before promotion, the source remains at its original path. The external journal recovers interrupted rename phases deterministically. Nerve never deletes the retained legacy backup automatically.

:::danger
Stop all Nerve processes before migration or manual state operations. Do not add `manifest.json` to a legacy directory manually; that does not convert its contents.
:::

## Next steps

- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Data locations](/reference/data-formats/)
