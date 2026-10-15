---
title: Storage and migration problems
description: Respond safely to incompatible state, startup upgrades, and cleanup failures.
sidebar:
  order: 7
---

## Incompatible state

Current state uses `manifest.json` with format `nerve-home`, version `1`. Nerve does not downgrade, reset malformed state, or open unknown/future versions. Nonempty homes without that manifest are unsupported; this version does not import older `nerve-workbench-state` layouts. Stop all Nerve processes and preserve the complete directory before trying a fresh, separate `NERVE_HOME`.

Do not add a manifest or change a migration checksum to make an old directory appear current.

## Migration aborts

Read the reported stage and error before retrying. Startup upgrades check source records, schema checksums, referenced assets, and destination integrity. The current conversation-core conversion keeps resumable work until verification; do not delete its retained source database, sidecars, work directory, or ledger to bypass a failure.

Back up the stopped home before an upgrade. The current conversion does not retain an automatic whole-home backup after success. If rehearsing on a copied home, also redirect project paths to copied projects: conversion can update project-resident `.nerve` configuration.

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
