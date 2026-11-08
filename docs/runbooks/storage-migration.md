# Storage migration: add or extend a step

Design and invariants are in [Storage migrations](../architecture/migrations.md). This is the procedure.

1. Check the root `package.json` version to identify the latest release. Extend the single unreleased draft step for changes since that release, or create a step when there is no draft.
2. Define owned inputs and isolated units using frozen local shapes and helpers. Keep legacy deletion in commit so earlier failures remain reversible. Do not read project files; project formats change through their own version chains.
3. For a new step, add its implementation to the ordered registry and its metadata to `MIGRATION_METADATA` ([`registry-metadata.ts`](../../packages/workbench-server/src/infrastructure/migrations/framework/registry-metadata.ts)). After any edit to a draft step, run `pnpm storage:checksums` to rewrite its checksum in `registry-metadata.ts` and `migrations.lock.json` (computed by [`hashStepFolder`](../../packages/workbench-server/src/infrastructure/migrations/framework/lock.ts)). Run `pnpm exec tsx scripts/storage-migrations/check.ts` to check consistency; the checker does not regenerate checksums.
4. Write fixture tests for corruption, set-aside, rollback and resume. Include byte-preservation and quarantine assertions where the step changes sources.
5. Rehearse on a stopped home copied into an unused slot, following the slot rule in the root [`AGENTS.md`](../../AGENTS.md): `pnpm storage:copy --from <stopped-home> --slot N`, then `pnpm storage:migrate --home data/storage-N`.
6. Run `pnpm exec tsx scripts/storage-migrations/validate-history.ts --home data/storage-N` and read every report's set-aside list. A clean exit only proves the history parses; an unexpected set-aside usually means a source was validated with the wrong shape.

Rehearsal limits: exception-injected phase tests do not cover every process-kill or durability boundary. Copied credentials can still reach real providers, and a daemon started on a copied home opens the registered projects' real directories, so point project paths at disposable locations first.
