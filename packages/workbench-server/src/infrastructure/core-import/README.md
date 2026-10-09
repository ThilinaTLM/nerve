# I1: legacy core importer

```sh
pnpm storage:import-core --home data/storage-2
# Replace the destination DB and regenerate imported overlays (originals unchanged):
pnpm storage:import-core --home data/storage-2 --force
```

Entry point: `importCoreStorage(input: { home: string; force?: boolean }): CoreImportSummary`
in `importer.service.ts`. The summary exposes table counts, skipped-item reason
counts, lossy-mapping reason counts, failed trees, asset coverage, and overlay-file
counts. Failed trees
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

Owned-file formatting, ESLint, and `cd packages/workbench-server && pnpm check`
pass. No tests or repository-wide checks were run.

## Selected-branch correction and verification

The follow-up reproduced 16 root conversations with incorrect user-message
sequences (including the abandoned first attempt in
`conv_01M2CYDH37DY13W0QX1V12EGMT`). Explicit Pi `parentId: null` now starts a
separate branch. Transcript predecessors are used only when an operational
record has no Pi parent field, never in place of an explicit null.

Execution starts are inserted at their first source entry's predecessor;
wait/retry/end facts extend that run's last source entry, not whichever branch
was appended most recently. Heads select the mapped old leaf. A source record
can expand into message plus execution/settlement facts, so its mapping names
the segment tail; only facts directly extending that segment can advance it.
Child heads use their recorded agent leaf (or latest source entry when absent).

Every import now reports `selectedPaths` verification and the CLI exits nonzero
for message-sequence, head-selection or tool-pairing mismatches. The independent
read-only comparison is:

```sh
pnpm exec tsx scripts/storage-migrations/verify-core-import.ts --home data/storage-2
```

Final copied-slot re-import completed with no failed trees. Both comparisons
checked 393 roots and 488 children: **0 user-message mismatches**, **0 unmapped
children**, and **0 head-mapping mismatches** in the importer. Across all 881
selected paths: **0 unanswered tool calls, 0 duplicate results, 0 orphan
results**. Foreign-key checks were empty; `quick_check` was `ok`.

Final `cd packages/workbench-server && pnpm check`, owned-file formatting and
ESLint passed. No tests were run. Evidence: `/tmp/i1-branches-before.json`,
`/tmp/i1-branches-after.json`, `/tmp/i1-branches-import-final.log`, and
`/tmp/i1-branches-check-final.log`. This follow-up read/wrote only the copied
`data/storage-2` databases, never either original home.

## File-owned capability and permission overlays

Legacy capabilities are parsed through `capabilityOverridesDocumentSchema` and
written as version 2 documents under
`data/conversations/<mappedConversationId>/config/capabilities.json`. Overrides
are normalized against the effective user/project selection using the host's
`userCapabilitySelection` and the shared resolution/normalization helpers. Only
project files trusted for their exact current digest participate. User settings
and project files are read-only; implicit project trust paths now use the host's
`.nerve/config/` locations. Archived harness selection `permissionLevel` fields
are projected to rule-set IDs only in memory while deriving this baseline; the
separate settings migration retains ownership of settings-file changes.

Conversation permission overlays are validated for conversation scope and copied
byte-for-byte to `data/conversations/<mappedConversationId>/config/permissions.json`.
Original legacy files are retained. SQLite configuration no longer maps
`enabledTools` or `enabledSkills`.

Final slot-2 re-import wrote **59 capability files** and **0 permission files**
(no legacy conversation permission overlays were present). A read-only check
against `CapabilityService.configuration` verified all 59 version-2 documents
were normalized and preserved the effective legacy selection: **0 failures**.
The standalone verifier still reports **393 roots + 488 children**, **0 message
mismatches**, and **0 unanswered / duplicate / orphan tool results**. Owned-file
formatting/ESLint and the final server package check pass; the earlier concurrent
cleanup blocker has been resolved. No tests or slot-5 import were run.

Evidence: `/tmp/i1-capabilities-import-final.log`,
`/tmp/i1-capabilities-verification.json`,
`/tmp/i1-capability-files-verification.json`, and
`/tmp/i1-capabilities-check-final.log`.

## Known lossy mappings / cutover follow-up

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
