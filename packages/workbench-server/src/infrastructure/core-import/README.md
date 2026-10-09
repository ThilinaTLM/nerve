# I1: legacy core importer

```sh
pnpm storage:import-core --home data/storage-2
# Rehearse again, replacing only the destination SQLite files:
pnpm storage:import-core --home data/storage-2 --force
```

Entry point: `importCoreStorage(input: { home: string; force?: boolean }): CoreImportSummary`
in `importer.service.ts`. The summary exposes table counts, skipped-item reason
counts, lossy-mapping reason counts, failed trees, and asset coverage. Failed trees
roll back independently; the CLI finishes the remaining trees and exits nonzero.

The source is opened read-only with `query_only`. A live home is rejected. Rows
are streamed with namespace/conversation predicates; `conversation_state`, replay,
journal, projection and lifecycle-work documents are never loaded. The destination
uses `openCoreStorage` and repository inserts, including full `events.insert`.
No processes are resumed, no old files are rewritten, and `processRef` stays null.

## Rehearsal handoff (2026-10-09)

Initial free disk space: 476 GB. `pnpm storage:copy --slot 2` correctly refused
because the production home had a live daemon. Instead, the existing
`cloneNerveHome` helper copied the stopped development home from `data/storage-1`
to `data/storage-2`. Only that copy was imported. Neither original database was
opened by the importer.

Final rehearsal: `pnpm storage:import-core --home data/storage-2 --force` completed
without failed trees. Log: `/tmp/i1-import-final.log`. Destination: approximately
1.9 GB, versus approximately 15 GB for the copied source database.

| Table               |                                      Imported rows |
| ------------------- | -------------------------------------------------: |
| project             |                                                 12 |
| trusted_resource    |                                                  7 |
| conversation        |                      881 (393 roots, 488 children) |
| conversation_config |                                                881 |
| conversation_event  |                                             105526 |
| tool_call           |                                                  0 |
| input_queue         | 0 (all 23 archived inputs were delivered/obsolete) |
| asset               |                                              26784 |
| async_bash          |                                                  9 |
| scratch_note        |                                                  2 |

Asset coverage: all 26748 scanned tool-call files, plus 36 promoted-task output
references. Two task output files were already missing; their metadata is retained.
Foreign-key checks were empty and `quick_check` returned `ok`. A streaming walk
of every selected branch found zero unmatched assistant calls and zero orphan
model tool results.

Owned-file formatting and ESLint pass. `packages/workbench-server` type checking
passed early in implementation; the final rerun is blocked by concurrent cutover
errors in other packages/server components. There were no importer diagnostics.
No tests or repository-wide checks were run.

## Known lossy mappings / cutover follow-up

- 59 legacy conversation capability overlays remain unchanged on disk, but are
  **not folded into current enabled-tools/skills lists**. Converting deny/default
  overrides requires the host's effective tool/skill baseline; resolve before
  production cutover. Likewise, any conversation permission overlay encountered
  is reported if its old managed-owner path needs relocation. None were present
  in this rehearsal.
- One root agent had been deleted. Its conversation survives with the latest
  historical assistant model; unavailable configuration fields use conversation
  values/defaults. One missing assistant tool-call block was reconstructed.
- 29 assistant blocks without durable results were settled as indeterminate,
  never replayed. Eleven selected branches lacked results recorded elsewhere;
  their recorded results were copied onto the selected branch. Existing branches
  and original result events remain intact.
- Four dismissed user-input resolutions have no equivalent typed resolution;
  the original interaction facts remain in result details. Other approval,
  question and plan-review resolutions are translated to the core schemas.
- Harness/task/subagent transcript notices become typed notifications. Execution
  starts, waits, retries and terminal states come from run records; other old
  lifecycle transitions are not retained. User images cannot fit the current
  text-only `user_message` payload and are reported if encountered. Legacy
  `instructions` are reported if present rather than inventing a config field.
- Approval-settlement workflow documents (9), UI launch tasks (35), current-only
  config entries (93), and one promoted task belonging to a deleted conversation
  were dropped. Existing lasting permission files are not modified.
- Pending command blocks retain completed receipts where available; uncertain or
  unstarted blocks are settled without repeating external effects. Run-targeted
  pending inputs are retargeted after settlement and reported. No pending inputs
  existed in the rehearsal, so those paths were not exercised on real data.
- Predicate-only prompt trust is not promoted to file-content trust. Such rows
  are explicitly skipped, rather than authorizing potentially changed content.

A production-home rehearsal remains outstanding because that home is running.
There is no runtime/bootstrap cutover in this workstream.
