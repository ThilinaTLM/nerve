---
title: Storage and migration problems
description: Respond safely to incompatible state, startup upgrades, and cleanup failures.
sidebar:
  order: 7
---

## Unsupported or damaged homes

The supported upgrade baseline is **Nerve 0.34.1**. New homes use `manifest.json` with format `nerve-home`, version `2`; versions `1` and `2` are accepted on read. Older layouts are not converted automatically. Do not add a manifest or change a migration checksum to make an old directory appear current.

If startup identifies a home older than the baseline, choose one of these options:

- **Upgrade through 0.34.1:** close Nerve and back up the complete home. Install [Nerve 0.34.1](https://github.com/ThilinaTLM/nerve/releases/tag/v0.34.1), run it once against that same home (`NERVE_HOME` if overridden), then close it and run the latest version. This route preserves conversation history.
- **Start fresh, keep providers:** confirm the desktop action to rename the old home to `<home>.archive-<timestamp>` and start a new home. Nothing in the original home is deleted. Conversations, artifacts, and runtime data remain in the archive, not in the new workbench.

Provider settings are copied only from a recognizable current layout and only if `config/providers.json` validates against the current schema. `secrets/credentials.enc` and `secrets/master.key` are copied only together, when the pair validates. No formats are converted. If nothing can be carried over, sign in to providers again. Permissions and project trust are not copied.

The archive remains until **you delete it**. **Settings → Storage** shows its location in both browser and desktop while it exists. Back it up before deleting it if you may need the history.

Damaged manifests, unreadable or unexpected ledgers, and unrecognized layouts offer the same confirmed fresh-start action, **Open data folder**, and **Copy diagnostics**. They do not suggest that upgrading through 0.34.1 will repair damaged metadata. Retry is offered only for failures identified as transient. Never share credential files with diagnostics.

## Migration aborts

Read the reported stage and error before retrying. Startup upgrades check source records, schema checksums, referenced assets, and destination integrity. The current conversation-core conversion keeps resumable work until verification; do not delete its retained source database, sidecars, work directory, or ledger to bypass a failure.

Back up the stopped home before an upgrade. The current conversion does not retain an automatic whole-home backup after success. Home upgrades touch only the Nerve home. Project configuration is upgraded separately when its feature loads it. A copied home can still point at real projects, so use copied projects when testing those features.

## Launch configurations conflict

Historical process definitions move to `.nerve/launches/definitions.json`. If the destination already exists, it wins and the old source is retained with a diagnostic. Review both files and resolve the conflict deliberately. Agents cannot create or edit launch definitions; use the Launches controls for normal changes.

## History or output appears missing

Check that you opened the intended home, project, conversation, and history branch. Sub-agents have their own conversations; selecting one in the activity island opens its history. Large tool output may be a linked managed asset rather than inline transcript text.

Retained output is not a recovered process. After daemon restart, async Bash becomes `lost` and live launch instances disappear. See [process recovery](/troubleshooting/tasks-and-recovery/) before starting replacements.

## Credentials are unavailable

Credentials are encrypted separately from conversation storage. Moving only the database does not move provider access. Preserve the full stopped home and reauthenticate through Settings if the copied credentials cannot be used. Never paste secret files into a report.

## Cleanup appears stuck

Cancellation is observed between operations, not inside every filesystem or database action. Wait for the current operation and inspect its status and logs. Skipped active conversations are expected. Cleanup does not offer a query-cache rebuild in the current runtime, and removing records does not necessarily shrink the database file immediately.

:::danger
Never manually edit or remove live state while desktop/daemon processes are running. Prefer a complete copied profile and explicit `NERVE_HOME` override.
:::

## Next steps

- [Storage and migration guide](/operations/storage-migration/)
- [Data locations](/reference/data-formats/)
