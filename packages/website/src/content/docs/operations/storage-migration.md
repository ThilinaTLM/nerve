---
title: Storage, cleanup, and migration
description: Back up Nerve state, inspect usage, prune safely, and understand startup upgrades.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. A current home is identified by `manifest.json` with format `nerve-home`, version `1`. Portable configuration lives under `config/`, credentials are encrypted under `secrets/`, and canonical conversation state lives in `data/nerve.sqlite`.

Electron's active Chromium profile remains outside `NERVE_HOME`. A whole-home backup therefore excludes browser session and device-local profile state. Project configuration, including `.nerve/launches/definitions.json`, also lives outside the home: back up the project separately.

## Conversation persistence

The conversation core stores projects, lead and child conversations, ordered history events, pending tool calls, queued inputs, resource trust, and async Bash metadata in SQLite. History follows a selected head through predecessor links, so branching does not require copying the complete transcript. History and reconnect reads are paged and byte-bounded; large tool output remains in managed files rather than being repeated in every response.

Streaming updates and workbench notices are not a durable event archive. Stored conversation events and referenced assets are the recovery source. There is no separate query-cache database to rebuild in the current runtime. These are implementation boundaries, not promises about benchmark speed or storage savings for a particular project.

## Back up before upgrades

Quit all desktop and daemon processes using the home, then copy the complete directory, including SQLite sidecars if present. Do not copy just `nerve.sqlite` from a running daemon or manually modify its tables. Keep project-resident `.nerve` configuration with the corresponding project backup.

## Inspect and clean up

**Settings → Storage** reports readable files under the Nerve home and runs asynchronous cleanup. Targets include old inactive conversations, dated logs, rotated event logs, crash reports, cache, and temporary files. Cleanup reports progress, skips symlinks, and observes cancellation between operations. Canonical database files, migrations, and backups are not disposable cache targets.

Conversation pruning protects active work. Review the cleanup result for skipped items rather than deleting their files manually. Removing rows and assets does not imply that the SQLite database file immediately shrinks by the same number of bytes.

## Startup upgrades

Startup checks the home manifest and migration ledger before opening runtime storage. The current conversation-core upgrade converts the preceding recognized SQLite layout, configuration, and referenced assets, verifies the result, and records completion. It does not resume operating-system processes. Async Bash metadata and retained output are distinct from a live process; launch instances are memory-only.

The upgrade also moves historical project process definitions to `.nerve/launches/definitions.json`. Existing launch configuration wins on a collision; inspect migration diagnostics and retained sources rather than overwriting them. Project files may be affected, so a home-only copy is not a fully isolated migration rehearsal unless its project paths also point at copies.

Migration work is resumable, but the current conversion does **not** retain an automatic whole-home backup after successful verification. Make your own stopped-home backup first. Do not delete migration work files or edit checksums to force an upgrade through.

## Unsupported layouts

A nonempty home without a valid `nerve-home` v1 manifest, malformed metadata, unknown schemas, and unsupported versions fail closed. This version does not import older `nerve-workbench-state` homes. Preserve the original directory and use an empty, separate `NERVE_HOME` if you need a fresh installation. Adding a manifest by hand does not convert storage.

:::danger
Never modify or remove live state while Nerve is running. For migration investigation, use a copied home and copied project configuration, not your only working profile.
:::

## Next steps

- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Data locations](/reference/data-formats/)
- [Process recovery](/troubleshooting/tasks-and-recovery/)
