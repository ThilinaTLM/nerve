# 0001 — conversation core (draft)

Frozen conversion from the 0.34.1 layout. Runtime imports are Node built-ins and
the framework step definition only. The local schema SQL is an exact snapshot of
the approved core v1, including its `schema_migrations` checksum. No schema change
is introduced here.

## Resumption and verification

Source sidecars move before the main `nerve.sqlite` rename. Once
`nerve.sqlite.migrating` exists, partial destination files can safely be discarded.
Every conversation tree commits separately, with an event-loop yield and progress
update. A retry restarts the import from the retained source, using deterministic
IDs. Managed config writes and promoted-output copies are idempotent.

Verification re-walks every old selected leaf and mapped new head, checks user
message digests and tool pairing, row counts, source file coverage, destination
asset sizes, schema checksum, foreign keys and `quick_check`. The successful
checkpoint retains only source-message digests and mapped heads, not snapshots.
It permits verification/cleanup to resume after source removal but before the
framework ledger append. No legacy data is removed before verification.

## Configuration conversion

- Harness `defaults` / `lastSelection`: `permissionLevel` → `permissionRuleSetId`.
- Flat settings `defaultPermissionLevel` / `lastAgentSelection.permissionLevel`:
  rule-set keys. Explicit existing IDs win. Other configuration is preserved.
- User suggestion frontmatter: `when.permissionLevels` → `permissionRuleSets`,
  without modifying body text or JavaScript. Predicate approval is retained only
  if its JS hash matches; file digests are then bound to the converted content.
  Unsupported YAML predicates, changed JS and unmapped projects need reapproval.
- Suggestion enablement becomes `config/prompt-suggestions.json`.
- Project task definitions become `.nerve/tasks/definitions.json`. Existing IDs
  win; legacy definitions are merged without launching anything. These files are
  project-resident, so real migrations can write outside the Nerve home.
- Legacy conversation capability/permission files are copied to full conversation
  IDs under `config/`, including the child scopes that shared the old owner.
  Capabilities normalize against user plus exact-digest-trusted project layers.
  Historical child tool allowlists become optional-tool overlays.
- Agent workspace roots and depth budgets are dropped, not invented as new
  columns. Readonly scopes become `read_only`. Working directories, model,
  reasoning, system prompt and current mode are preserved. Old availability
  fields are not written into SQLite. Core tools cannot be hidden by optional
  capability overlays; permission policy remains authoritative.

## Cleanup and limits

Referenced task outputs are copied to
`data/conversations/<id>/async-bash/<bashId>/` before deleting `data/tasks`.
After verification: remove the `.migrating` database/sidecars, query-cache database
and sidecars, `journal` / `data/journal`, old `data/migrations` and root migration
entries (except framework `work` and `last-failure.json`), `migration-journal.json`,
and obsolete `data/state.sqlite` / `data/core.sqlite`. Existing tool-call files
remain referenced in their old managed directories. The runner removes its
scratch directory after recording the ledger. No backup is retained.

Disk admission requires 4 GiB, with an additional runtime check for 15% of the
source DB size. No processes resume; imported bash `processRef` stays null.
Historical losses remain documented in the architecture migration notes, including
indeterminate calls, unsupported user-image/config fields and already-missing
asset references. This development rehearsal is not production-home coverage.

## Rehearsal evidence

Copied stopped `data/storage-1` with `cloneNerveHome` into slot 6 (5.4 s). To avoid
project-resident writes to real workspaces, only the copied project-directory and
agent-workdir metadata were redirected into slot-local rehearsal projects; their
`.nerve/config` and task definitions were copied. Conversation records were not
changed. No source-home file was edited.

The initial migration completed in 75 s: 393 roots + 488 children, 105,526 events,
26,784 assets, 9 bash rows, 268 capability files and no permission files. Eleven
legacy task definitions merged with eight existing definitions. New DB:
2,004,914,176 bytes (~1.87 GiB), versus ~15.3 GB source. All 105,526 event payloads
also passed the current application schema in a separate read-only check.

Evidence: `/tmp/m1-rehearsal.log`, `/tmp/m1-rehearsal-summary.json`, and
`/tmp/m1-dry-run-after.log`. Final copied-slot timings/startup and validation are
recorded in the completion handoff.
