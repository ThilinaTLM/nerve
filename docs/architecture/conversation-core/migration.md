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
| Conversation-level capability overrides and approval settlements                                                                                                                       | Existing files retained; capability conversion/permission relocation reported           |
| Files on disk + `file_assets`                                                                                                                                                          | `ASSET`                                                                                 |
| `durable_events`, `conversation_state`, journal documents, `lifecycle_*`, `run_lifecycle_records`, obligations, completions, projections, `rpc_idempotency`, query cache, empty tables | Dropped                                                                                 |

## Strategy

- **New file, read-only import.** Create the new schema in a fresh database and fill it with a one-shot importer that only reads the old database. The old file is the backup.
- **Per conversation.** Import one conversation tree at a time so failures are isolated and reportable.
- **Settle in-flight work first.** Unfinished runs, interactions and tool calls are imported as `cancelled` or `indeterminate` responses with matching `execution_state` events; pending approvals do not survive cutover.
- **No coexistence.** The old and new tool lifecycles are too different to run side by side. The runtime cuts over at once.
- **Rehearse on copies.** Run the importer repeatedly against copies of both homes (`pnpm storage:copy --slot N`), compare conversation counts, context projections and asset coverage, then switch `~/.nerve`.
- **After cutover**, core schema changes use the ordered SQL migrations in [`conversation-core/src/storage/migrations.ts`](../../../packages/conversation-core/src/storage/migrations.ts). The old home-wide migration framework and its proposal are removed.

## Replaced code (pre-cutover analysis)

| Area                                                                                                 | Size                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Server domains built on the current model: `agents`, `runs`, `tools`, `conversations`, `human-input` | about 38k lines                       |
| Persistence and migration infrastructure                                                             | about 15k lines                       |
| Files querying the affected tables directly                                                          | 35 files, 9.4k lines                  |
| `agentId` / `runId` usage                                                                            | 32 contracts files; 58 / 35 app files |
| Server tests, mostly for the replaced machinery                                                      | about 56k lines                       |

The app's inline display of child transcripts changes to navigation into child conversations.

## Implemented importer

```sh
pnpm storage:import-core --home data/storage-2          # refuses if data/core.sqlite exists
pnpm storage:import-core --home data/storage-2 --force  # replaces data/core.sqlite only
```

[`importer.service.ts`](../../../packages/workbench-server/src/infrastructure/core-import/importer.service.ts) opens `data/nerve.sqlite` read-only and creates `data/core.sqlite`. Startup never imports automatically. `--force` removes the destination and its WAL/SHM files, not the source. Existing managed files are scanned/referenced, not rewritten.

The importer maps projects, root/child conversations and current config, event trees, tool responses, pending inputs, promoted bash, trusted resources, scratch notes and assets. It never loads old snapshots, replay streams, journals, projections or lifecycle-work documents. Each conversation tree imports transactionally; failed trees roll back independently, remaining trees continue, and the CLI exits nonzero. The report includes counts, skips, lossy mappings, failed trees and asset coverage.

Unfinished calls become cancelled/indeterminate facts, not resumable approvals or effects. Missing assistant results are synthesized as indeterminate; results missing on a selected branch may be copied onto it. Imported bash has null `processRef`; no process is resumed.

The development-copy rehearsal imported 881 conversations (393 roots, 488 children), 105,526 events, 26,784 assets and 9 async bash rows, with no failed trees. All 26,748 scanned tool-call files were tracked; two already-missing task output files retained metadata. SQLite checks and selected-branch tool pairing passed. These results do not establish production-home coverage.

### Known lossy mappings

- Legacy capability overrides are not folded into `enabledTools`/`enabledSkills`; lasting permission files are unchanged, and old owner paths needing relocation are reported.
- Missing/deleted agent configuration uses historical model/conversation values/defaults. Missing assistant call blocks can be reconstructed.
- Dismissed user-input resolutions have no equivalent typed resolution; original facts remain in result details.
- Harness/task/subagent notices become notifications. Run records supply execution start/wait/retry/terminal events; other lifecycle transitions are dropped.
- User image attachments and legacy `instructions` have no matching current prompt/config field and are reported.
- UI launch tasks, approval-settlement workflow documents and historical config-change entries are dropped. Launch instances are memory-only.
- Pending command blocks keep available completed receipts; uncertain/unstarted blocks are settled without repeating effects. Run-targeted inputs are retargeted after settlement and reported; the rehearsal had no pending inputs to exercise these paths.
- Predicate-only prompt trust is skipped, not treated as file-content trust.

### Production-import prerequisites

1. Resolve **59 legacy conversation capability overlays** against the host's effective tool/skill baseline before production import; converting deny/default overrides without that baseline is unsafe.
2. **Stop the daemon** before copying/importing the production home. The importer rejects a live PID in daemon metadata. Rehearse on a stopped copy and review counts, losses, branches and asset coverage before cutover.

The legacy database remains available for backup/reference; this importer is not an atomic whole-home promotion or a general migration framework.
