---
title: Back up, move, and upgrade data
description: Back up your Nerve home and projects, move them to another machine, clean up space, and know what happens on upgrade.
sidebar:
  order: 5
---

`NERVE_HOME` defaults to `~/.nerve`. A current home is identified by `manifest.json` with format `nerve-home`; new homes are written as version `2`, and version `1` is still read. Portable configuration lives under `config/`, credentials are encrypted under `secrets/`, and conversation identity, history and lifecycle live in `data/nerve.sqlite`. Agent settings and conversation prompt context are authoritative JSON, not SQLite configuration.

Electron's active Chromium profile remains outside `NERVE_HOME`. A whole-home backup therefore excludes browser session and device-local profile state. Project configuration, including `.nerve/launches/definitions.json`, also lives outside the home: back up the project separately.

## Conversation persistence

The conversation core stores projects, lead and child conversations, ordered history events, pending tool calls, queued inputs, resource trust, and async Bash metadata in SQLite. History follows a selected head through predecessor links, so branching does not require copying the complete transcript. History and reconnect reads are paged and byte-bounded; large tool output remains in managed files rather than being repeated in every response.

Streaming updates and workbench notices are not a durable event archive. Stored conversation events and referenced assets are the recovery source. There is no separate query-cache database to rebuild in the current runtime. These are implementation boundaries, not promises about benchmark speed or storage savings for a particular project.

Conversation `data/conversations/<id>/config/agent.json` holds explicit choices, an applied profile snapshot and local prompt context. Working directory stays on the SQLite conversation record. List summaries in `cache/conversation-agent-summaries.json` are disposable and may be unknown; they are not executable settings.

## Back up your data

Nerve has no conversation export or import. To keep your history, back up the whole home.

1. Quit every Nerve window and daemon that uses the home.
2. Copy the complete `NERVE_HOME` folder, including configuration, encrypted credentials, database companion files, and managed files.
3. Back up each project folder separately. A home backup doesn't include your source tree or the project's own `.nerve` configuration, such as launch definitions.

Don't copy `nerve.sqlite` alone from a running daemon, and never edit its tables. Conversations and tool output can contain prompts, source, paths, commands, and provider details, so don't share a whole home or its secret files as a diagnostic attachment.

## Move to another machine

1. Quit Nerve on both machines.
2. Copy the home folder to the new machine, then copy your projects.
3. Start Nerve with `NERVE_HOME` pointing at the copied folder. Provider sign-ins are stored in the home; if they don't work on the new machine, sign in again from **Settings → Providers**.

Each project remembers its folder path. Restore project folders to the same paths so their conversations, launches, and notes line up. Opening a folder from a different path creates a new project; existing conversations stay with the original one.

## Remove projects and prune conversations

Removing a project deletes its conversations and related records from Nerve; it doesn't delete the project folder. Cleanup can prune old inactive conversations by age or count and always protects active work.

## Inspect and clean up

**Settings → Storage** reports readable files under the Nerve home and runs asynchronous cleanup. Targets include old inactive conversations, dated logs, rotated event logs, crash reports, cache, and temporary files. Cleanup reports progress, skips symlinks, and observes cancellation between operations. Canonical database files, migrations, and backups are not disposable cache targets.

Conversation pruning protects active work. Review the cleanup result for skipped items rather than deleting their files manually. Removing rows and assets does not imply that the SQLite database file immediately shrinks by the same number of bytes.

## Startup upgrades

Startup checks the home manifest and migration ledger before opening runtime storage. The current conversation-core upgrade converts the preceding recognized SQLite layout, configuration, and referenced assets, verifies the result, and records completion. It does not resume operating-system processes. Async Bash metadata and retained output are distinct from a live process; launch instances are memory-only.

The upgrade also moves historical project process definitions to `.nerve/launches/definitions.json`. Existing launch configuration wins on a collision; inspect migration diagnostics and retained sources rather than overwriting them. Project files may be affected, so a home-only copy is not a fully isolated migration rehearsal unless its project paths also point at copies.

Migration work is resumable, but the current conversion does **not** retain an automatic whole-home backup after successful verification. Make your own stopped-home backup first. Do not delete migration work files or edit checksums to force an upgrade through.

The scoped-configuration upgrade converts released v0.37.0 `harness.json`, `capabilities.json` and `subagents.json` into agent preferences, creation preferences and per-name profile definitions. It verifies exports before removing SQLite conversation configuration; frozen legacy readers are migration-only. Remembered selections are folded once where enabled; remember-last-selection and parent-copy behavior are removed. Review the upgrade report for dropped conversation sub-agent fields, child snapshots and trust that must be granted again. Later-encountered projects upgrade before activation.

## When something is damaged

Since this release, one broken file no longer stops Nerve from starting.

- **Unreadable conversation or settings file:** Nerve sets it aside and keeps going. A single upgrade report appears in **Notifications** under System. Unreadable conversations are listed there with a per-row delete and **Delete all**.
- **Corrupted project file:** Nerve shows a notice with **Open file**, **Reload**, and **Reset**. Until you fix it, Nerve uses a safe fallback and won't save over the corrupted file. Reset asks for confirmation first.
- **Project file from a newer version:** it opens read-only so an older Nerve can't overwrite it.
- **Old project file names:** a notice offers **Remove old files**, with confirmation.
- **Home that can't be opened:** the desktop startup screen shows what to do next.

See [Storage and migration problems](/troubleshooting/storage-and-migration/) for step-by-step fixes.

## Unsupported layouts

A nonempty home without a valid `nerve-home` manifest, malformed metadata, unknown schemas, and unsupported versions fail closed. This version does not import older `nerve-workbench-state` homes. Preserve the original directory and use an empty, separate `NERVE_HOME` if you need a fresh installation. Adding a manifest by hand does not convert storage.

:::danger
Never modify or remove live state while Nerve is running. For migration investigation, use a copied home and copied project configuration, not your only working profile.
:::

## Next steps

- [External editors](/integrations/external-editors/)
- [Storage troubleshooting](/troubleshooting/storage-and-migration/)
- [Data locations](/reference/data-formats/)
- [Process recovery](/troubleshooting/tasks-and-recovery/)
