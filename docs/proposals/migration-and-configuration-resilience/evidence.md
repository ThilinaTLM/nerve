# Evidence

Part of [Migration and configuration resilience](./README.md). Recorded 2026-10-30 against root package version 0.37.0.

## Migration rehearsals

Two backups were copied into disposable slots and migrated offline with `pnpm storage:migrate --home <isolated-home>`. Project paths were redirected so that no real project files were written. No daemon, UI, or provider work was started.

| Source backup         | Rehearsal slot   | Result                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/storage-0-37-0` | `data/storage-6` | **Succeeded.** Applied `0002-agent-profiles`. 1,012 conversations, 158,611 events, and 133,880 assets preserved. Integrity `ok`, 0 foreign-key violations, 0 set-aside items. A second run was a no-op. One reported behavioural loss: bundled Explore/Developer parent-copy model and reasoning behaviour. |
| `data/storage-0-34-1` | `data/storage-5` | **Blocked safely** in `0001-conversation-core` preflight. No data changed, and a retry reproduced the failure.                                                                                                                                                                                              |

## The slot-5 blocker

[`config-preflight.ts`](../../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/config-preflight.ts) applies the legacy version-1 validator (`Expected version 1 with a definitions list`) to legacy `tasks/definitions.json` sources and also to existing `launches/definitions.json` targets. Two projects had valid version-2 launch catalogs, newer than the backup, so preflight rejected them and blocked the whole home migration. The [conversion code](../../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/configuration.ts) already preserves existing targets on collision, but preflight fails before that code runs.

This is the motivating example for separating home and project migration. A valid, newer project file was treated as corrupt, and one project file stopped the entire home from migrating.

## Code findings

- **Ambiguous admission error:** `FLOOR_ERROR = "Run Nerve 0.34.1 first"` is used for several unrelated admission failures ([`ledger.ts`](../../../packages/workbench-server/src/infrastructure/migrations/framework/ledger.ts)).
- **Retry offered for permanent failures:** `startupErrorRetryable` returns `true` for unstructured errors ([`loading-pages.ts`](../../../packages/desktop-shell/src/window/loading-pages.ts)).
- **Wrong manifest version in message:** `NERVE_HOME_VERSION = 1` appears in the rejection message, while the schema accepts versions 1 and 2 ([`state-layout.ts`](../../../packages/workbench-server/src/infrastructure/storage-bootstrap/state-layout.ts)).
- **Permission listing throws:** rule-set listing parses files without isolating failures ([`permission-rule-sets.ts`](../../../packages/workbench-server/src/core-host/permission-rule-sets.ts)).
- **Load-time conversion in a feature loader:** the launch definition repository converts version 1 to version 2 on read ([`launch-definition.repository.ts`](../../../packages/workbench-server/src/domains/launch-definitions/launch-definition.repository.ts)).
- **Steps still editable:** both home steps are still `draft` in [`migrations.lock.json`](../../../packages/workbench-server/src/infrastructure/migrations/migrations.lock.json). Released steps are checksum-locked and immutable.

## Limitations

- The backups contain no historical project configuration. Rehearsals paired each home with copies of current project files.
- Only offline migration and integrity were exercised. Daemon startup, UI recovery, and provider execution were not tested, and no corruption-injection or interruption experiments were run.
- The [rehearsal helper](../../../scripts/storage-migrations/rehearse.ts) assumes a legacy `domain_documents` database, so it does not work unchanged for a 0.37.0 source.
- Detailed evidence is local only: `data/storage-5/migrations/last-failure.json`, `data/storage-6/migrations/reports/0002-agent-profiles.json`, and `/tmp` reports. The rehearsal slots contain copied credentials and should not be started casually.

## Set-aside rehearsal after implementation

Fresh copy: `pnpm storage:copy --from data/storage-0-34-1 --slot 5`.
Migration: `pnpm storage:migrate --home data/storage-5` — passed.
The source dataset was not modified; no daemon was started.

Reports: `data/storage-5/migrations/reports/0001-conversation-core.json` and `0002-agent-profiles.json`.
Quarantine: `data/storage-5/quarantine/` (including preserved missing-asset descriptors).
No conversations or settings documents were set aside in this dataset.

| Step | Reason                                                                                 | Count |
| ---- | -------------------------------------------------------------------------------------- | ----: |
| 0001 | Assistant tool-call block without durable result settled as indeterminate              |    27 |
| 0001 | Legacy interaction retained in result details rather than typed resolution             |     2 |
| 0001 | Selected branch lacked a result recorded elsewhere; result copied onto selected branch |     4 |
| 0001 | Missing legacy assets                                                                  |     7 |
| 0002 | Removed bundled Explore/Developer parent-copy model and reasoning behavior             |     1 |
| 0002 | Dropped legacy compaction field customKeepRecentPercent                                |   828 |

These are counts of reported conversion occurrences, not distinct conversations or settings documents. Loss reasons contain no absolute paths. Original item-level quarantine receipts remain available for recovery; activity details group set-aside receipts by reason.

Validation: 131 migration unit tests and four report/dismissal unit tests passed. Migration checksums were regenerated with `hashStepFolder`, and `pnpm exec tsx scripts/storage-migrations/check.ts` passed. Workbench Svelte validation reported zero errors and zero warnings.
