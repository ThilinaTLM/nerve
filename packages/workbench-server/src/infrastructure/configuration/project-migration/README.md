# Lazy project configuration migration

`ProjectMigrationService` is instantiated with the explicit Nerve home. Add each descriptor (and optional existing trust-resource kind) to `descriptors.ts`; bootstrap requires no per-type edits. It does not enumerate projects or watch files. Feature loaders call `load(context, descriptor)` every time they load a resource; descriptor defaults are fresh values, not shared mutable objects.

Each descriptor owns its relative `.nerve` path, current version, version field and absent-field default, UI label and reset description, frozen pure N-to-N+1 functions, current schema, fallback and confirmed-reset replacement (`null` removes an override). Ordered `legacySources` declare their supported versions and optional version accessors. Project sources are relative to `.nerve`; home sources are relative to the explicit home and may derive their filename from the project context. The first existing source wins, only when the current path is missing. A corrupted source never falls through to a lower-priority source. Originals are retained unchanged.

The service validates before writing, acquires the same persistent `.lock` used by launch catalog mutations, preserves exact original bytes under:

```
<home>/quarantine/project-configuration/<sha256(projectId)>/<sha256(absolute source path)>/<sha256(original bytes)>.original
```

Originals are exclusively created and synced before an atomic mode-0600 replacement. Source bytes and legacy target absence are checked again immediately before writing. A concurrent change abandons the candidate and reloads (bounded retries); arbitrary noncooperating writers cannot be made transactional by a filesystem rename. Lock files are never stolen based on PID or age, and cleanup checks inode identity.

Use `projectMigrationTrust(() => storage, typeToTrustKind)` for byte-bound trust carry-over. Only an exact trusted input is eligible, and the source trust binding and written bytes are rechecked. Resets revoke existing source/target trust before replacement, including an approval whose digest happens to equal the reset defaults. Launch definitions have no trust resource kind today and need no trust adapter entry.

## Health and recovery contract

Contracts are exported from `@nervekit/contracts/projects`:

- `ProjectConfigurationHealth`: `{ projectId, issues }`.
- Each issue: `{ projectId, type, label, resetDescription, path, classification, message, resetOffered }`. Paths are absolute (also enforced by the contract). Labels and reset descriptions come from the mandatory descriptor fields, never UI hard-coded type switches.
- Classifications in health are `migrated`, `corrupted`, `incompatible`; healthy resources have no issue. Successful migration information persists until explicit reload. Only corrupted files offer reset.
- Operations: `project.configuration.health` (`{ projectId }`) and `project.configuration.resolve` (`{ projectId, type, action: "reload" }` or `{ projectId, type, action: "reset", confirmed: true }`), returning health.
- Event: `project.configuration.health`, containing the full updated health for that project.

Register descriptors before resolving by type ID. `health()` reports only resources loaded in this process; it intentionally does not scan project files. Wire the service's `changed` callback to the public event publisher. Reload updates health after manual edits. Reset rechecks classification and exact bytes, refuses newer-version files and requires literal confirmation. Files are never heuristically repaired.

## Integration handoff

- `app/bootstrap/create-runtime-services.ts` owns a shared service using the explicit runtime home and publishes the project-scoped health event. The lazy trust-storage getter avoids construction cycles.
- `descriptors.ts` is the single type/trust-kind registry. Add future project types there; no bootstrap changes are needed. Descriptor labels/reset descriptions are mandatory.
- `create-server-adapter-contexts.ts` supplies the shared service to `project-method-handlers.ts`. Health and confirmed recovery use the existing operation dispatcher over both WebSocket protocol and HTTP `/api/protocol/v1`.
- `production-admission-fixture.ts` supplies an isolated service to its repository.
- `conversation-channel.ts` no longer invokes home-step code on project open. The obsolete `project-open-migration.test.ts` was deleted; lazy creation, source precedence, corruption and original preservation are tested at the owning launch layer.
- Activity/inline notices remain a subsequent UI phase. No watcher is introduced.

`transact(context, descriptor, mutate)` is the ordinary feature-write entrypoint. It migrates an older valid file before acquiring its mutation lock, then revalidates under that lock. Corrupted/incompatible files reject the mutation callback entirely, so a fallback can never overwrite their bytes. Transactions validate the candidate, detect concurrent byte changes and write atomically. Launch create/update/delete/reorder all use this framework transaction. Confirmed reset is the only writer allowed to replace a corrupted file; incompatible files remain read-only.

## Home staging for legacy DB launch definitions

0001's frozen `legacy-launch-definitions.ts` exports every `task_definitions` document to `<home>/data/launches/legacy/<sha256(normalized project id)>.json`, retaining taskdef IDs and frozen v1 fields. It never opens a project path, including when the owning project is unreadable. Staging is journaled, merges identical retries safely, and rejects conflicting definitions instead of overwriting preserved data.

When the current launch catalog is absent, lazy loading tries project `tasks/definitions.json`, then this home staging file. Either runs through the same tasks-v1 -> launches-v1 -> launches-v2 chain. Successful migration leaves staging unchanged and also preserves the original in home quarantine. Staging precedence and the complete 0001-to-lazy-loader path have unit coverage.

## 0001 project behavior removed

- `config-preflight.ts`: project settings and tasks/launch catalog discovery, validation and path ownership.
- `owned-paths.ts`: project configuration filename inventory.
- `configuration.ts`: legacy DB task-definition export into projects, tasks-to-launches file move, project permission-rule rewriting, and project prompt-trust file/predicate reads. Existing project byte-digest approvals can still be imported without opening their files; predicate-only approvals require reapproval.
- `step.ts`: project subagent profile traversal and conversion (`.nerve/subagents` to `.nerve/config/subagents.json`). The frozen `convertProfileScope` / `profileReceiptPath` helpers and Markdown shapes remain in `subagent-profiles.ts` / `subagent-profile-format.ts` for phase 2; home profile conversion still uses them.
- `conversation-overlays.importer.ts`: project capability inheritance reads during conversation conversion. Explicit conversation opinions are preserved rather than normalized against an unavailable project baseline; reconstruction of legacy child-agent tool snapshots uses home settings only.

The removed tasks-file conversion is now the launch chain's first legacy-source step, followed by home staging. Project overlay/profile chains are implemented in phase 2; see the domain integration section below.

## Changed-file inventory

Under `packages/contracts/src/domains/projects/`:

- `configuration-health.ts` (new schemas/types), `events.ts` (health event), `operations.ts` (health/resolve operations), `index.ts` (exports).

Under `packages/workbench-server/src/`:

- `infrastructure/configuration/project-migration/`: `project-migration.ts`, `project-migration.test.ts`, `project-migration-trust.ts`, `project-migration-trust.test.ts`, `descriptors.ts`, `README.md` (new framework, trust adapter, tests and handoff).
- `domains/launch-definitions/`: `launch-definition-migrations.ts`, `launch-definition-migrations.test.ts`, `launch-definition-staging.test.ts` (chain and staging precedence); `launch-definition.repository.ts`, `launch-definition-catalog.test.ts`, `launch-definition-operations.test.ts` (framework integration and adjusted tests).
- `core-host/`: `permission-rule-sets.ts`, `permission-rule-sets.test.ts` (isolation); `permission-configuration.ts`, `permission-configuration.test.ts` (invalid overlays cannot be edited/trusted implicitly).
- `infrastructure/migrations/steps/0001-conversation-core/`: `config-preflight.ts`, `configuration.ts`, `conversation-overlays.importer.ts`, `importer.service.ts`, `owned-paths.ts`, `step.ts`, `legacy-launch-definitions.ts`, `legacy-launch-definitions.test.ts` (home-only conversion and legacy DB staging); `config-preflight.test.ts`, `step.test.ts`, `subagent-profiles-safety.test.ts`, `ancillary.test.ts` (updated assertions).
- `infrastructure/migrations/framework/registry-metadata.ts`, `infrastructure/migrations/migrations.lock.json` (0001 checksum).

- `app/bootstrap/create-runtime-services.ts`, `app/bootstrap/create-server-adapter-contexts.ts`, `adapters/protocol/handlers/project-method-handlers.ts` (runtime, API and event integration).
- `core-host/execution-admission/production-admission-fixture.ts`, `adapters/protocol/conversation-channel.ts` (updated callers); `adapters/protocol/project-open-migration.test.ts` (obsolete eager-conversion test deleted).

## Validation handoff

Commands executed from the repository root unless shown otherwise:

```sh
pnpm --filter @nervekit/contracts build
pnpm fix:focused
pnpm exec tsx scripts/storage-migrations/check.ts
pnpm check:focused
```

Contracts build, focused fix, server type-check (`pnpm exec tsc -b packages/workbench-server --pretty false`) and migration lock check passed. The final 0001 checksum is `765d83c6c9f3c925b46e09c09ab0be7fa6541b796dc33fa0f8457145198886df`, recomputed with `hashStepFolder` after formatting. `step.test.ts` is 789 lines.

The prior five server integration diagnostics have been addressed. The repository-wide focused check is currently blocked by concurrent UI package-boundary violations in `ProjectConfigurationHealthWatcher.svelte` (deep feature-state import) and `ProjectConfigurationHealthItem.svelte` (presentation imports application state). Those files were not edited by this task. An additional `production-admission.test.ts` run reported `Profile unavailable: worker` in concurrent profile configuration code; that code was not changed by this task.

The following exact unit command passed **76/76 tests**, including classification, version accessor/default, failed migration, quarantine/write failure, concurrent changes, migration trust, reset/revocation, legacy launches, invalid permission listing and the touched 0001 behavior:

```sh
cd packages/workbench-server
pnpm exec tsx --test src/infrastructure/configuration/project-migration/project-migration.test.ts src/infrastructure/configuration/project-migration/project-migration-trust.test.ts src/domains/launch-definitions/launch-definition-migrations.test.ts src/domains/launch-definitions/launch-definition-staging.test.ts src/domains/launch-definitions/launch-definition-catalog.test.ts src/domains/launch-definitions/launch-definition-operations.test.ts src/core-host/permission-rule-sets.test.ts src/core-host/permission-configuration.test.ts src/infrastructure/migrations/steps/0001-conversation-core/legacy-launch-definitions.test.ts src/infrastructure/migrations/steps/0001-conversation-core/ancillary.test.ts src/infrastructure/migrations/steps/0001-conversation-core/config-preflight.test.ts src/infrastructure/migrations/steps/0001-conversation-core/step.test.ts src/infrastructure/migrations/steps/0001-conversation-core/subagent-profiles.test.ts src/infrastructure/migrations/steps/0001-conversation-core/subagent-profiles-safety.test.ts
```

Earlier validation failures were resolved: one unused import, the step-test line limit and obsolete tests expecting eager home-to-project conversion. An initial unit invocation required rebuilding contracts after concurrent settings-contract work; contracts were rebuilt successfully before the passing runs. No broad suites, daemon instances, pristine datasets, real home data or DB schema changes were used.

## Domain integration (phase 2)

The registry now includes scoped agent settings, conversation defaults, capabilities,
integrations, subagent catalogs and permission overlays. It also inventories profile
and suggestion factories: their owners register stable per-entry descriptors on
first use, without a project scan. Every descriptor provides `label`,
`resetDescription` and the resource's safe fallback. Full paths, versions, source
precedence and reset/trust policies are documented in
[`agent-configuration/project-chains/README.md`](../agent-configuration/project-chains/README.md).

Additional descriptor capabilities:

- `decode` / `encode` retain Markdown files as Markdown. Current validators reject
  old spellings; only pure version steps convert them.
- Legacy `inputs` declare composite read-only dependencies, including explicit
  home dependencies. Each input has its own version accessor and optional trust
  kind. Every snapshot is preserved and rechecked before writing. Health points
  to the actual failing companion, not an unrelated primary source.
- A source `select` distinguishes an absent catalog entry from an invalid entry;
  only absence can continue to another source. `shared` prevents per-entry reset
  from revoking a sibling's shared catalog approval.
- Trust capture can derive targets across existing kinds and fan out from one
  catalog without moving its source approval. Target digests use the feature's
  established convention; raw and prefixed legacy SHA-256 inputs are recognized.
- Declarative `migrationDependencies` run before a migration write, with cycle detection. Integration account metadata cannot retire v1 selections before the agent chain imports them, regardless of feature load order.
- Transactions accept async callbacks and validated replacement values. Healthy
  entry removal is serialized and preserves originals. Confirmed repair may use
  the recovery writer with a validated replacement and expected source digest;
  incompatible files remain read-only.
- Removal/reset writes a digest-bound suppression receipt in home quarantine so
  an unchanged retained legacy source cannot silently reactivate. A shared
  catalog is not deleted when resetting one entry.
- `onResolved` republishes loaded feature generations after explicit health
  Reload/Reset; it does not introduce watchers. Results carry the exact source
  digest so cached capabilities cannot bind unrelated bytes to parsed settings. `onHealthChanged` invalidates published permission policies when another loader discovers an invalid overlay. Invalid UTF-8 and escaping/dangling symlinks are rejected without repairing bytes or overwriting external targets.

Runtime project loading no longer invokes home-step converters. Frozen conversion
shapes/helpers are copied into the domain chains. The production-admission worker
fixture now uses the current `whenToUse` field; user-edited builtin profiles were
not changed.
