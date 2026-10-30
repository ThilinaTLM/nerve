# Home migration

Part of [Migration and configuration resilience](./README.md).

## Scope

Home migration converts everything Nerve owns inside the home:

- the database and conversation history
- assets and artifacts
- user-level settings in `config/`
- credentials in `secrets/`

It runs at startup, once per upgrade, through the [existing step framework](../../architecture/migrations.md). Following the repository rule, every unreleased home change goes into the single draft step.

**Home migration never reads or writes project files.** Project configuration has its own lazy system ([project migration and recovery](./project-migration-and-recovery.md)). This is why they are kept apart:

- Project files live outside the home, are often in Git, and may be shared with teammates or installations running other versions.
- A home can be restored independently of its projects, so their histories do not line up. A project file can already be newer than the home, which is exactly the slot-5 blocker (see [evidence](./evidence.md#the-slot-5-blocker)).
- Some registered projects are unreachable at startup, so per-project handling is needed regardless.
- One project file should never be able to stop the home from migrating.

## Per-item failures are set aside, not fatal

The framework already has set-aside and discard concepts, including [0001 quarantine](../../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/quarantine.ts) and message salvage. The rule should hold for every step:

- **Blocking:** the manifest or ledger cannot be trusted, the database fails integrity checks, or a step cannot run at all.
- **Set aside:** a single conversation, event, asset, or user-level settings document fails conversion. It is preserved in quarantine, recorded in the migration report, and the migration continues.
- **After startup:** set-aside items appear as one activity notice in the header, for example "3 conversations could not be migrated". No confirmation dialog is shown before the application opens.

A user-level settings document that was set aside is then handled like any invalid home document: in-memory defaults, plus the existing Settings Health notice with reload and confirmed reset.

## Removing project handling from 0001 and 0002

Both draft steps are home-only. 0001 no longer preflights project configuration, converts project task files or traverses project subagent Markdown. 0002 no longer merges project harness/capability/catalog/integration files or carries project trust across files. Neither step can be blocked by an inaccessible or newer project configuration file.

0001's `legacy-launch-definitions.ts` and call site have also been removed: legacy task definitions stored **only in a 0.34.1 home database are not carried over**. There is no home staging directory/source for project launches. This intentional data-compatibility reduction requires review confirmation before release.

Project handling is limited to lazy **same-file version bumps** ([project migration](./project-migration-and-recovery.md#versions-and-legacy-files)). Old project filenames generate a notice asking users to configure the settings again; nothing imports or merges them. Confirmed Remove old files preserves them in home quarantine and removes them. Only same-file bumps can retain exact-byte trust; resetting never grants it.

Both home steps remain `draft` in [`migrations.lock.json`](../../../packages/workbench-server/src/infrastructure/migrations/migrations.lock.json). After removing 0001 staging, its checksum is recomputed using `hashStepFolder` and recorded in the registry metadata and lock. No database schema change is involved.
