# 0001 — conversation core (draft)

Frozen conversion from the 0.34.1 layout. Runtime imports are Node built-ins and
the framework only. The local schema SQL is an exact snapshot of
the approved core v1, including its `schema_migrations` checksum. No schema change
is introduced here.

## Resumption and verification

Source sidecars move before the main `nerve.sqlite` rename. Once
`nerve.sqlite.migrating` exists, partial destination files can safely be discarded.
Every conversation tree commits separately, with an event-loop yield and progress
update. A retry restarts the import from the retained source, using deterministic
IDs. Managed config writes and promoted-output copies are idempotent.

Verification uses import receipts (source-message digests, mapped heads, source
conversation count and enumerated asset paths), then checks replacement history,
tool pairing, projected payloads, row counts, asset coverage/sizes, schema checksum,
foreign keys and `quick_check`. It does not re-walk source histories or source
asset directories. Destination payload and file checks remain necessary: import
receipts cannot prove the replacement has not been damaged after import.

The runner executes read-only `check`, isolated `run`, and `verify`; it persists
`verified.json` before calling `commit`. Once marked, a restart retries cleanup
only, and rollback is unavailable. No legacy database is removed before commit.

## Ownership, failed units and rollback

The frozen JSON ownership set derives from v0.34.1:

- Home `config/{daemon,harness,ui,permissions,providers,integrations}.json`:
  `infrastructure/storage-bootstrap/paths.ts`.
- Home `config/rule-sets/*.json`:
  `domains/permissions/permission-policy.service.ts` (`customRuleSets`).
- Registered projects' `.nerve/config/{harness,ui,providers,integrations}.json`:
  `infrastructure/configuration/project-configuration.ts`.
- Project and conversation permissions/capabilities overlays:
  `domains/{permissions,capabilities}` services.
- Project `.nerve/tasks/definitions.json`:
  `domains/task-definitions/task-definition.repository.ts`.
- Conversion outputs (`subagents.json`, home `prompt-suggestions.json`, project
  `.nerve/launches/definitions.json`) are also checked to avoid overwriting a
  conflicting existing target. Legacy sub-agent and suggestion Markdown resources
  are owned conversion inputs, not arbitrary project files.

Unowned JSON, including `config/mcp.json` and old `config/settings.json`, is ignored.
Checked reads have exact-path ownership enforcement and reject symlink traversal.
The check retains JSON documents for conversion instead of reparsing them.
Unreadable runtime-owned home documents are left for runtime settings recovery.

`ctx.unit` aggregates independent failures, isolates journaled file changes and
report checkpoints, and supports a caller-supplied transaction hook. Conversation
imports retain their SQLite transaction. Ancillary decoding uses relational owner
columns and valid owning documents; an unowned unreadable record becomes a
configuration unit `legacy-record:<namespace>/<document_id>`. An unreadable project
also reports its affected conversations. Missing project relationships during a
conversation import belong to that conversation, not the whole home.

Set-aside choices survive retries in scratch `discarded.json`. Files move into
`home/quarantine/0001-conversation-core/<unit>/payload/<basename>` with `reason.json`.
Database-backed units stream only their own raw rows to `payload/records.jsonl`
(`{ table, row }`, with SQLite BLOB values encoded as `{ "$blob": "<base64>" }`)
and move their managed directories. Repeated exports deduplicate rows. Moves use rename, with synced copy/remove
across devices. Quarantine survives successful upgrade until the user deletes it.
Import-only failed conversations reuse the previous completed import when excluded;
verification failures require a rebuild.

The framework writes a private `migrations/reports/0001-conversation-core.json`
after successful commit if units were set aside or import losses were recorded.
Reports and sibling `.seen` dismissal files survive scratch cleanup.

Before verification, framework rollback restores journaled original file bytes,
renames and directory entries; the extra step hook removes the replacement DB and
returns the retained source/sidecars. The framework restores the exact pre-step
manifest, including baseline admission bytes when applicable. Rollback is resumable.

## Conservative message salvage

Automatic repair is deliberately bounded to **JSON-decode failures in non-root
`message` rows** of an otherwise provably linear, single-agent text history:

- One explicit root agent with a stored model and an existing project; no child
  agents, queued inputs, tasks, runs, or tool-associated asset rows.
- Intact relational conversation/agent IDs and stored timestamps, positive unique
  increasing sequences,
  and a complete parent chain: the first row has no parent and every later row
  names the preceding row. A damaged row must have a surviving predecessor.
- Selected-head rows agree on the terminal record. Every readable neighbor is a
  text-only user/assistant message whose embedded parent agrees with the columns.
  Branches, ambiguous heads, non-text/tool-bearing neighbors, and malformed
  ownership are not repaired. Valid JSON with a broken semantic shape is not
  treated as a decode failure.

A lost row becomes an existing `system_event/notification`, visible in the
transcript, explicitly saying its speaker/content are unknown. It is history-only
(`llmRepresentation: "none"`), not an invented user/assistant message or tool fact.
Readable user **and** assistant messages and their chain are retained. Nothing in
this repair guesses authorization, permissions, configuration, or tool outcomes;
those records remain configuration/conversation failures when unreadable.

Each damaged raw row is streamed to its own journaled quarantine entry before
verification/cleanup, with its exact BLOB bytes encoded losslessly. The owning
conversation is retained, so this does **not** add a whole-conversation set-aside
report item. Instead each durable report loss identifies the source conversation,
record ID, sequence, decode damage, and quarantine path. Placeholder digests join
import receipts; verification checks their identity/text and surviving history
without rereading source JSON. Only damaged units pay a metadata-only chain pass.

If later evidence makes repair unsafe, the conversation transaction, raw-record
archive, receipts, and loss entries roll back together and the entire conversation
is reported. Pre-commit home rollback restores original database/configuration
bytes. Successful salvage needs one import; its receipts and raw archive also
survive the existing import-reuse-on-discard path for unrelated failed units.

## Configuration conversion

- Harness `defaults` / `lastSelection`: `permissionLevel` → `permissionRuleSetId`.
- Owned settings permission-selection keys become rule-set keys. Explicit existing
  IDs win. Unowned legacy `settings.json` is not converted.
- User suggestion frontmatter: `when.permissionLevels` → `permissionRuleSets`,
  without modifying body text or JavaScript. Predicate approval is retained only
  if its JS hash matches; file digests are then bound to the converted content.
  Unsupported YAML predicates, changed JS and unmapped projects need reapproval.
- Suggestion enablement becomes `config/prompt-suggestions.json`.
- Legacy project definitions are merged into the historical task file, then moved
  to `.nerve/launches/definitions.json` with `launchdef_` IDs. An existing launches
  file wins; the old file is retained and a collision is reported. The same frozen
  move runs on `project.create`, covering projects unknown during home migration.
  These files are project-resident, so rehearsals must redirect copied project paths.
- Historical process calls and responses are rewritten together: linked
  `task_start` → background `bash`; selector-free `task_status` → `async_bash list`;
  ID-only logs and stop → `async_bash logs/stop`. Ambiguous names, cursors, modes,
  restarts and unmatched results retain generic original arguments/results. Bash
  arguments lose timeout; pending calls are settled, never resumed. Result assets
  are regenerated with matching lengths and digests by the existing writer.
- Process permission grants are action-constrained; broad/ambiguous legacy grants
  become ask rules (`decision: "prompt"`) with diagnostics, preserving consultation
  without granting new permissions. Denials/prompts are conservatively mapped;
  the old group becomes `process`. User/project/conversation files and user custom
  rule-set files are covered, including custom sets containing only unsafe grants.
  Home settings already default `bash.maxTimeoutMs` to 900000, so no redundant
  stored default is added.
- `data/launches/task_*` directories become `launch_*`; collisions retain both.
- Legacy conversation capability/permission files are copied to full conversation
  IDs under `config/`, including the child scopes that shared the old owner.
  Capabilities normalize against user plus exact-digest-trusted project layers.
  Historical child tool allowlists become optional-tool overlays.
- Agent workspace roots and depth budgets are dropped, not invented as new
  columns. Readonly scopes become `read_only`. Working directories, model,
  reasoning, system prompt and current mode are preserved. Old availability
  fields are not written into SQLite. Core tools cannot be hidden by optional
  capability overlays; permission policy remains authoritative.

## Profile conversion limits

Only user resources and registered projects are converted. Later-opened old
projects need explicit canonical `.nerve/config/subagents.json` conversion;
there is no runtime legacy Markdown profile loader. Preserve profile names,
instructions, settings, and explicit toggles. Conflicting legacy/canonical
profiles or incompatible whole-map versus sparse-map capability shadowing are
configuration-unit failures for the canonical profile target. Repair the source
and retry, or explicitly set the unit aside; do not invent toggles or broaden
capabilities. Raw sources remain recoverable.

## Development homes with an earlier draft applied

Extending this unreleased step does not rerun an already-applied ledger entry.
Use a fresh home or an isolated copy of a pre-upgrade baseline; do not remove
ledger entries to replay against converted data. This is a draft-development
limitation, not a compatibility loader or a new released migration step.

## Cleanup and limits

Referenced task outputs are copied to
`data/conversations/<id>/async-bash/<bashId>/` before deleting `data/tasks`.
After verification: remove the `.migrating` database/sidecars, query-cache database
and sidecars, `journal` / `data/journal`, old `data/migrations` and root migration
entries (except framework `work`, `reports` and `last-failure.json`), `migration-journal.json`,
and obsolete `data/state.sqlite` / `data/core.sqlite`. Existing tool-call files
remain referenced in their old managed directories. The runner removes its
scratch directory (including the rollback journal) after recording the ledger.
No whole-home backup is retained after success; quarantine and upgrade reports remain.

Disk admission requires 4 GiB, with an additional runtime check for 15% of the
source DB size. No processes resume; imported bash `processRef` stays null.
Import summaries and durable reports record losses such as indeterminate calls,
unsupported user-image/config fields and already-missing asset references. This development rehearsal is not production-home coverage.

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

A separate earlier PR recovery rehearsal covered 311 conversations, roughly
90–100 seconds of import, and byte-identical restoration. That copied-home evidence
predates the conservative message-salvage extension above; it is not evidence of
universal repair or exhaustive crash coverage. This extension's tests use fresh
temporary homes, not real storage slots.

The shared suite injects crash exceptions at progress events; targeted journal
unit tests also interrupt rollback checkpoints. These do not cover every process-
kill/durability window. `pnpm storage:rehearse` prepares isolated home/project copies,
optional corruptions and baseline checksums, and prints manual lifecycle recovery
instructions; it does not automatically drive the recovery API.
