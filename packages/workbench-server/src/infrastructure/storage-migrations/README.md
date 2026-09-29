# Storage migrations

This directory is immutable storage history. `steps/index.ts` is the single ordered registry and `migrations.lock.json` records review state and released compatibility checksums.

## Choosing a mechanism

- Optional persisted field: make the reader tolerant; no step.
- Breaking JSON shape: bump its payload version and add an upgrader.
- Table, column, or index: schema step.
- Existing-data backfill: schema step followed by data step.
- Managed-file move: files step; only create staged paths.
- Cross-document configuration move: config step.

## Adding a step

1. Choose the next four-digit ordinal and add one folder under `steps/`.
2. Import only concrete versioned files under `kit/` and files in the step's own folder. Never import contracts, domains, persistence, runner code, zod, Node built-ins, or a barrel.
3. Declare minimal loose historical shapes locally. Preserve unknown fields.
4. Treat stored data as hostile. Data/file callbacks are record boundaries; let malformed records throw so the runner can quarantine them.
5. Guard every SQLite JSON function with `json_valid` and the expected `json_type`.
6. Add the step to the end of `steps/index.ts` and add a `draft` lock entry.
7. Test a release-shaped record and malformed/non-object/unknown-field cases. Verify invariants, not implementation details.
8. Finalization formats the folder, hashes all non-test files, and changes the lock stage to `final`. Never edit a final or released step or a versioned kit file it uses; add a corrective step.

`0006` intentionally differs from its legacy SQL by guarding every JSON input. Legacy raw-SQL hashes live in `legacyAdoptionChecksums`; they are evidence for adopting the old ledger, never accepted checksum drift for a framework step. `acceptedChecksums` is reserved for checksums of previously finalized framework step folders. Steps `0008` and `0009` own frozen minimal shapes rather than importing current application contracts. Step `0010` verifies the exact non-unique, non-partial, one-column deletion indexes.

`migrations.lock.json` is the review and tooling authority. `steps/registry-metadata.ts` mirrors its runtime fields because package builds do not copy the JSON lock into `dist`; its consistency test must be updated with every lock change.

## Persisted-reader compatibility

Readability sweeps are keyed by the generated identity in `read-compatibility.ts`, not by the application release. Changes to payload descriptors, codecs, upgraders, reachable persisted contract schemas, sweep dispatch, or runtime validator versions must refresh it with `pnpm migrations:update-read-compatibility`. Repository policy rejects stale generated metadata. Unrelated release-version changes do not invalidate a completed sweep.

Released migration steps remain immutable. On a direct 0.31.1 upgrade, the 0.32.0 steps 0005–0010 are resolved once through checksummed legacy adoption or application; 0.32.1 and 0.32.2 added no migration steps. Successful production readability evidence from those releases is adopted only for the specifically reviewed compatibility identity in `read-compatibility-evidence.ts`; that evidence also recognizes the stale `0.31.1` build label emitted by packaged 0.32 startup when `npm_package_version` was absent.
