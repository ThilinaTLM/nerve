# Storage migrations

> **Status:** Being implemented on `feat/conversation-core`. This document is the design; keep the implementation this small.

One mechanism upgrades a Nerve home from one release to the next: SQLite schema and data, managed files, and configuration files. It runs once at daemon startup, before any storage is opened.

## Principles

- **Small.** A registry of steps, a runner, and a ledger. No staging copies, workers, quarantine or compatibility sweeps.
- **Resumable, not transactional.** A step may take minutes on a large home and touch many files, so it cannot be one transaction. Every step must be safe to run again after a crash and continue from where it stopped.
- **Frozen.** A step never imports application code. It reads and writes storage with Node built-ins and local shapes, so later refactors cannot change what an old step does. A released step is never edited; fixes are new steps.
- **One baseline.** The first step starts from release 0.34.1. Older homes must be opened with 0.34.1 first.

## Layout

```text
packages/workbench-server/src/infrastructure/migrations/
├── framework/          # runner, ledger, step type, context
├── steps/
│   ├── index.ts        # ordered registry
│   └── 0001-conversation-core/
└── migrations.lock.json
```

## Steps

```ts
export default defineStep({
  id: "0002-example", // four-digit ordinal + name, matches the folder
  description: "What changes and why",
  requiresFreeBytes: 0, // optional; checked before run
  async run(ctx) {
    /* idempotent */
  },
  async verify(ctx) {
    /* optional invariant checks; throw on failure */
  },
});
```

The context provides only what every step needs: home `paths`, a per-step `scratchDir` for checkpoints, `progress(...)` and `log(message)`. Steps use `node:fs/promises` and `node:sqlite` directly.

## Progress

A migration can take minutes, so the user must always see what is happening. A step reports each phase with a plain-language label and, when it knows them, a count and total ("Importing conversations", 120 of 393). The desktop splash shows "Upgrading local storage" with that label and count under it, and fills its progress bar while a count is known. The terminal (`pnpm desktop:*`, the daemon log and `pnpm storage:migrate`) logs the start, every phase change with the previous phase's duration, periodic progress during long phases and a final summary or the failure with the path of its report. Long loops yield to the event loop so progress keeps arriving.

Writing a resumable step:

- Make each action detect whether it already happened (a file already moved, a marker row present, a checkpoint in `scratchDir`).
- Replace files atomically (write a temp file, then rename).
- Never delete the only copy of data before its replacement is verified.

## Ledger

Applied steps are recorded in the home's `manifest.json` as `migrations: [{ id, checksum, appliedAt }]`, written atomically after each step's `verify` passes. The ledger lives outside SQLite so a step can replace the database file.

## Runner

At startup, under the existing home lock:

1. **Empty home:** initialize at the latest layout and record every registered step as applied. Nothing runs.
2. **Existing home:** it must either have a ledger or be a 0.34.1 home (manifest version 1, and the 0.34.1 migration ledger in `data/nerve.sqlite` contains steps 0001–0010). Anything else fails with "Run Nerve 0.34.1 first". The ledger must not contain unknown step IDs.
3. Run each pending step in order: free-disk check, `run`, `verify`, ledger entry, delete `scratchDir`. Progress is shown in the existing startup UI.
4. On failure, write `migrations/last-failure.json` (step, phase, error) and do not start. The next start resumes the same step.

`pnpm storage:migrate --home <dir> [--dry-run]` runs the same runner against a stopped home, for rehearsals on copied slots.

## Immutability

`migrations.lock.json` maps each step ID to its folder's checksum and its stage (`draft`, or `released` with `releasedIn`). `pnpm check` fails when a released step's files no longer match. Draft steps may change until the release that ships them.

## Database schema changes

The conversation core owns its SQL schema and applies its own ordered SQL migrations when it opens the database (`SCHEMA_MIGRATIONS`), so the package stays portable. Use a core SQL migration for a pure schema change. Use a home step when a change also touches files or configuration, or converts data across stores. Every schema change needs prior agreement; see the root `AGENTS.md`.

## Step 0001 — conversation core

Converts a 0.34.1 home to the conversation-core layout:

1. Rename `data/nerve.sqlite` (and its WAL/SHM files) to `data/nerve.sqlite.migrating`. When resuming, keep the renamed file and discard any partial new database.
2. Create a new `data/nerve.sqlite` with the core schema and import projects, conversations, events, inputs, async bash, trust, scratch notes and assets from the old database. The importer code is copied into the step folder and frozen there.
3. Write conversation capability and permission files under `data/conversations/<id>/config/`.
4. Convert configuration: permission levels become permission rule sets; prompt-suggestion files use `permissionRuleSets`.
5. Delete legacy files: task bundles, the query cache, journal and old migration folders.
6. `verify`: the selected history of every conversation matches the old database, tool calls and results pair up, heads map, and foreign keys and integrity checks pass.
7. Delete `data/nerve.sqlite.migrating`, with no backup.
