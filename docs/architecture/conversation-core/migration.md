# Migration

Part of the [conversation core redesign](README.md).

## Legacy database analysis

Measured read-only on the development home (`data/storage-1/data/nerve.sqlite`, schema version 8) on 2026-10-09. The production home is similar in size (15.5 GB).

- 15.3 GB, 62 tables, about 30 populated; the rest are leftovers of earlier designs.
- 393 conversations; 880 agents (392 root, 488 children: 190 Explore, 84 async developer, 214 other); up to 18 agents per conversation.

| Table                   | Size    | Rows | Content                                                                                                        |
| ----------------------- | ------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `durable_events`        | 5.5 GB  | 2.4M | Replay stream: tool-call revisions, child transcript deltas (499k), delivery receipts (443k), activity changes |
| `domain_documents`      | 4.6 GB  | 95k  | 4.2 GB is `conversation_state` snapshots, the largest 267 MB                                                   |
| `conversation_records`  | 3.5 GB  | 163k | Messages 1.05 GB, tool calls 1.06 GB, runs 1.25 GB                                                             |
| `run_lifecycle_records` | 0.25 GB | 1.8k | Run state                                                                                                      |

Most of the volume is duplicated or derived:

- `conversation_state` documents repeat entries, idempotency keys (109 MB in one document), run projections and tool calls already stored elsewhere.
- Run records average 724 KB because every transition is kept inside the record.
- Each tool result is stored twice: in the tool-call record and as a `toolResult` message.
- Actual model context (Pi messages) is about 1.04 GB; transcript display entries about 63 MB.

The original estimate was 1–1.5 GB; importing a copy of the development home produced about 1.9 GB.

Other findings:

- **Asset tracking is incomplete:** 26,748 tool-call files on disk, 945 `file_assets` rows. The importer must build `ASSET` from a disk scan plus payload references.
- **In-flight work at measurement:** 2 open runs, 2 pending interactions, 2 waiting tool calls, 7 `outcome_unknown` work items, 196 `ready` execution attempts (apparently stale), 1 ready obligation.

## Mapping

| Legacy                                                                                                                                                                                 | New                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `project` documents                                                                                                                                                                    | `PROJECT`                                                                               |
| `conversation` document + root agent document                                                                                                                                          | `CONVERSATION` + `CONVERSATION_CONFIG`                                                  |
| Child agents sharing a conversation (`contextOwnerAgentId`)                                                                                                                            | Child `CONVERSATION`; records split by `agent_id`                                       |
| Pi message records (tree via `parentId`)                                                                                                                                               | `CONVERSATION_EVENT`; `parentId` → `previous_event_id`, leaves → selected head          |
| Harness messages, task, subagent and run-status entries                                                                                                                                | `system_event`                                                                          |
| `model_change`, `thinking_level_change`, `active_tools_change` entries                                                                                                                 | Dropped; configuration is current-only                                                  |
| Compaction summaries                                                                                                                                                                   | `compaction`                                                                            |
| Branch summaries                                                                                                                                                                       | `compaction` on the branch                                                              |
| Run records and transitions                                                                                                                                                            | `execution_state` events (start and end)                                                |
| Tool-call records                                                                                                                                                                      | `tool_call_response` payload: arguments, provider ID, outcome, supervision, interaction |
| `agent_inputs`                                                                                                                                                                         | `INPUT_QUEUE`, pending only                                                             |
| `task` documents from tool promotion                                                                                                                                                   | `ASYNC_BASH` for retained promoted tasks; no process resumes                            |
| `task` documents from the UI                                                                                                                                                           | Dropped; launch instances are in memory                                                 |
| Project/file-content trust documents                                                                                                                                                   | `TRUSTED_RESOURCE`                                                                      |
| `scratch_notes`                                                                                                                                                                        | `SCRATCH_NOTE`                                                                          |
| Conversation-level capability overrides and approval settlements                                                                                                                       | Conversation config files; overlays normalized against user/trusted-project layers      |
| Files on disk + `file_assets`                                                                                                                                                          | `ASSET`                                                                                 |
| `durable_events`, `conversation_state`, journal documents, `lifecycle_*`, `run_lifecycle_records`, obligations, completions, projections, `rpc_idempotency`, query cache, empty tables | Dropped                                                                                 |

## Strategy

[Storage migrations](../migrations.md) is the binding startup design. Step 0001
renames the legacy database to `data/nerve.sqlite.migrating`, reads it without
loading snapshots/replay/journal documents, and creates the already-approved core
schema in a new `data/nerve.sqlite`. Each conversation tree imports transactionally.
An interrupted import restarts from the retained source; configuration rewrites
are atomic and idempotent. Verification precedes removal of the source and legacy
files. There is no retained database backup: rehearse on a copied, stopped home.

Unfinished runs and calls become cancelled/indeterminate facts rather than resumed
effects. After cutover, pure core schema changes use the core package's ordered SQL
migrations; home-wide changes use the startup step registry.

## Replaced code (pre-cutover analysis)

| Area                                                                                                 | Size                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Server domains built on the current model: `agents`, `runs`, `tools`, `conversations`, `human-input` | about 38k lines                       |
| Persistence and migration infrastructure                                                             | about 15k lines                       |
| Files querying the affected tables directly                                                          | 35 files, 9.4k lines                  |
| `agentId` / `runId` usage                                                                            | 32 contracts files; 58 / 35 app files |
| Server tests, mostly for the replaced machinery                                                      | about 56k lines                       |

The app's inline display of child transcripts changes to navigation into child conversations.

## Implemented step 0001

```sh
pnpm storage:migrate --home data/storage-6 --dry-run
pnpm storage:migrate --home data/storage-6
```

[`0001-conversation-core/step.ts`](../../../packages/workbench-server/src/infrastructure/migrations/steps/0001-conversation-core/step.ts)
is registered as a draft migration. Its importer, SQL schema, row writers and
capability helpers are frozen locally and use only Node built-ins (plus the
framework context). The standalone importer and `storage:import-core` command are
removed. Startup and this CLI run the same step under the home lock.

The step converts permission-level selection keys to rule-set IDs, user suggestion
frontmatter to `when.permissionRuleSets`, suggestion enablement to
`config/prompt-suggestions.json`, and validated predicate approvals to file-content
trust. Project task definitions move to `.nerve/tasks/definitions.json`, preserving
existing IDs. Legacy workspace budgets/roots are not retained; readonly scopes
become `read_only`. Conversation overlays are normalized and copied to full-ID
config paths, including child scopes and historical child tool allowlists.

Promoted bash outputs are copied into conversation-owned storage before deleting
task bundles. Selected histories, mapped heads, tool pairing, row counts, scanned
asset coverage, foreign keys and SQLite integrity must pass before cleanup. A
verified checkpoint bridges a crash between source removal and the ledger write.
The disk floor is 4 GiB plus a runtime check for 15% of the old database size.

Remaining historical losses: missing assistant results are settled indeterminate;
selected-branch result gaps are copied from recorded results; dismissed resolutions
remain in result details; notices become notifications; user images and legacy
`instructions` have no matching current field. UI launch instances, approval
workflow documents, old lifecycle projections and historical config-change entries
are dropped. Unsupported/stale suggestion predicates require reapproval, never a
guessed trust grant. Already-missing asset references retain metadata.

The final slot-8 rehearsal copied the stopped development home in 4.7 seconds,
migrated in 74 seconds, and started `pnpm dev --slot 8` in 49 seconds. The channel
listed all 881 conversations (393 roots, 488 children); the daemon was then stopped.
Dry-run reported nothing pending. The new DB is 2,004,914,176 bytes (~1.87 GiB),
versus ~15.3 GB source; the complete copied home is 2.3 GiB.

Imported: 105,526 events, 26,784 assets, 9 async bash rows, 268 capability files and
no conversation permission files. Eleven legacy project task definitions merged
with existing file definitions. Selected history/tool pairing, foreign keys and
integrity passed. Rehearsal project paths were redirected only in the copied DB,
with project config files copied into the slot, avoiding writes to real workspaces.
These results do not establish production-home coverage. See the step README for
cleanup paths and limits. Evidence: `/tmp/m1-slot8-migrate.log`,
`/tmp/m1-slot8-summary.json`, `/tmp/m1-slot8-dry-run.log`, and
`/tmp/m1-slot8-channel.log`.
