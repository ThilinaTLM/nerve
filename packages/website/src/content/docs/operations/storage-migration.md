---
title: Storage, cleanup, and migration
description: Back up Nerve state, inspect usage, prune safely, and migrate the preceding home format.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. A current home is identified by `manifest.json` with format `nerve-home`, version `1`. Portable configuration lives in six versioned files under `config/`, credentials are encrypted under `secrets/`, canonical conversation state lives in `data/nerve.sqlite`, and managed files use logical home-relative references.

Electron's active Chromium profile remains outside `NERVE_HOME`. A whole-home backup therefore excludes browser session and device-local profile state by design.

## Inspect and clean up

Settings can estimate usage and run asynchronous cleanup for old conversations and diagnostics, event compaction, reports, cache/temp data, and rebuildable indexes. Cleanup skips symlinks and observes cancellation between targets.

Conversation pruning skips running or awaiting agents and conversations with active tasks before removing associated inactive records and managed files.

## Legacy v2 migration

Ordinary startup never guesses or repairs an unknown home. The sole import path is an explicit offline migration from the immediately preceding marker:

```json
{
  "format": "nerve-workbench-state",
  "version": 2
}
```

Local desktop mode detects this exact format and asks for confirmation. Remote desktop mode does not inspect local `NERVE_HOME`. Unknown, malformed, and newer layouts remain untouched.

Before migration, quit every Nerve process that uses the source home. Migration then:

1. acquires a sibling startup lock and recoverable journal;
2. creates an isolated v1 staging home and a consistent read-only snapshot of legacy SQLite;
3. imports and validates configuration, recognized encrypted credentials, projects and agents needed by conversations, conversation records and durable events, referenced payloads, and plans;
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
