# Storage migration commands

Use the root pnpm commands: `migrations:check`, `storage:migrate`,
`storage:copy`, and `storage:rehearse`. They share `run.mjs`, which first builds
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
`node scripts/storage-migrations/run.mjs baseline --slot 3`.
Migration validation and storage operations remain in their existing
entrypoints; the runner neither opens storage nor changes migration checksums.

Runner unit tests: `node --test scripts/storage-migrations/test/run.test.mjs`.
See [repository scripts](../README.md) for safe copy/rehearsal usage.
