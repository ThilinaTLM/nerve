# Storage migration commands

Use the root pnpm commands: `migrations:check`, `storage:migrate`,
`storage:copy`, and `storage:rehearse`. They share `run.ts`, which first builds
`@nervekit/workbench-server^...`: pnpm's workspace dependency closure for the
server, excluding the server itself. The existing TypeScript entrypoint then
runs via tsx with all arguments forwarded unchanged. A failed build prevents
the script from running; the script's exit status is preserved.

These scripts import server source, whose workspace package imports resolve to
built `dist` exports. The checker and offline migrator load the migration
registry (including conversation-core); copy/rehearsal also load bootstrap
helpers that import contracts. Shared preparation keeps all four usable after
a fresh install without maintaining a second dependency graph or building the
server/UI. Build scripts remain incremental. Direct `tsx` invocation bypasses
this preparation and requires dependencies to have been built already.

The standalone baseline command also imports the home lock. To prepare its
dependencies before hashing, use
`node scripts/storage-migrations/run.ts baseline --slot 3`.
Migration validation and storage operations remain in their existing
entrypoints; the runner neither opens storage nor changes migration checksums.

Runner unit tests: `node --test scripts/storage-migrations/test/run.test.ts`.

## Slots, copies and rehearsal

Daily development: `pnpm desktop:dev`, `pnpm dev`, and `pnpm dev:ui` accept `--slot N`. `pnpm storage:copy --slot N` seeds an unused disposable slot from a stopped `~/.nerve`. Add `--from <path>` to copy another stopped home instead: `pnpm storage:copy --from data/storage-0-34-1-do-not-use --slot 4` or `pnpm storage:copy --from data/storage-2 --slot 4`. Relative source paths resolve from the working directory. The destination must be unused; desktop profiles are not copied. Copied credentials and project paths can still access real providers/files, so storage isolation is not a sandbox. `pnpm desktop:prod` explicitly launches source code against real user data. Home migrations run before startup storage opens; `pnpm storage:migrate --home <copied-home> [--dry-run]` rehearses the same runner against a stopped copy. Released step 0001 replaces the legacy database with its frozen core v1 schema at `data/nerve.sqlite`. Home step 0002 migrates agent-profile documents/data on both legacy and already-upgraded homes; core SQL v2 runs when core storage subsequently opens. Rehearsals must therefore run `storage:migrate` and then open core storage to exercise the full **0001 → 0002 → core v2** path. Released SQL/schema text and applied home steps are immutable, regardless of a historical `draft` lock label. The one exception is an unreleased draft step registered with `rerunOnChange`: when its checksum changes, homes that already applied it re-run its applied-home path (currently 0002 rewrites profile documents) and the ledger entry is replaced; the flag must be removed when the step is released.

### Storage migration rehearsal

`pnpm storage:rehearse --from /absolute/baseline-home --slot 3 [--corrupt PRESET] [--keep]`
copies a stopped baseline with `cloneNerveHome`, redirects registered legacy
projects to `data/storage-3-projects/<basename>` (only `.nerve` is copied), and
writes `data/storage-3-baseline.sha`. Slot 1 is always refused. Existing homes
and project copies require `--force-reset` (both are then removed under the slot lock).
Project basename collisions and symbolic links are refused rather than merged.

Presets are `config`, `overlay`, `conversation`, `message`, `runtime-json`, and
`runtime-shape`; selection is deterministic and missing inputs are errors.
Checksums cover the copied home and project configuration **after** redirection
and corruption. Follow the printed start/restore commands, stop the daemon after
restoration, then run `sha256sum -c data/storage-3-baseline.sha` from the checkout.
The script never starts a server or drives destructive recovery automatically.
Copies remain available for inspection; `--keep` suppresses the printed cleanup
command. Credentials are copied: this is storage isolation, not a provider sandbox.

Baseline hashing reads files in 64 KiB chunks and streams checksum lines to an
atomic, mode-0600 output file. If preparation completed but hashing failed, keep
the slot stopped and run
`pnpm exec tsx scripts/storage-migrations/rehearse-baseline.ts --slot 3` to create
only the baseline checksums. This does not copy, redirect projects, or inject
corruption again; do not use it after starting an upgrade, since it hashes the
slot's current state.
