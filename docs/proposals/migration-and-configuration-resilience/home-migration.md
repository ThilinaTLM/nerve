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

Both steps currently read project `.nerve/` directories:

- **0001** runs a configuration preflight over project files and converts `tasks/definitions.json` into launch definitions.
- **0002** converts legacy project files such as `harness.json`, `capabilities.json`, and `subagents.json`, and carries project trust over.

Both steps are still `draft` in [`migrations.lock.json`](../../../packages/workbench-server/src/infrastructure/migrations/migrations.lock.json), so they can still change before release. The project parts move into the first versions of the matching project migration chains. The conversion logic is kept, not dropped; it just moves.

Consequences:

- The slot-5 blocker disappears, because 0001 preflight no longer validates project launch catalogs.
- 0002's project-trust carry-over must be re-homed in the project migration framework (see [trust](./project-migration-and-recovery.md#project-trust)).
- The removal and the replacement chains must ship in the same release. Otherwise users coming from 0.34.1 or 0.37.0 lose legacy project configuration in between.
