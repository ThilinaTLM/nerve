# Migration

Part of the [conversation core redesign](README.md).

## Current database

Measured read-only on the development home (`data/storage-1/data/nerve.sqlite`, schema version 8) on 2026-10-09. The production home is similar in size (15.5 GB).

- 15.3 GB, 62 tables, about 30 populated; the rest are leftovers of earlier designs.
- 393 conversations; 880 agents (392 root, 488 children: 190 Explore, 84 async developer, 214 other); up to 18 agents per conversation.

| Table | Size | Rows | Content |
| --- | --- | --- | --- |
| `durable_events` | 5.5 GB | 2.4M | Replay stream: tool-call revisions, child transcript deltas (499k), delivery receipts (443k), activity changes |
| `domain_documents` | 4.6 GB | 95k | 4.2 GB is `conversation_state` snapshots, the largest 267 MB |
| `conversation_records` | 3.5 GB | 163k | Messages 1.05 GB, tool calls 1.06 GB, runs 1.25 GB |
| `run_lifecycle_records` | 0.25 GB | 1.8k | Run state |

Most of the volume is duplicated or derived:

- `conversation_state` documents repeat entries, idempotency keys (109 MB in one document), run projections and tool calls already stored elsewhere.
- Run records average 724 KB because every transition is kept inside the record.
- Each tool result is stored twice: in the tool-call record and as a `toolResult` message.
- Actual model context (Pi messages) is about 1.04 GB; transcript display entries about 63 MB.

Expected size after migration: roughly 1–1.5 GB.

Other findings:

- **Asset tracking is incomplete:** 26,748 tool-call files on disk, 945 `file_assets` rows. The importer must build `ASSET` from a disk scan plus payload references.
- **In-flight work at measurement:** 2 open runs, 2 pending interactions, 2 waiting tool calls, 7 `outcome_unknown` work items, 196 `ready` execution attempts (apparently stale), 1 ready obligation.

## Mapping

| Current | New | Difficulty |
| --- | --- | --- |
| `project` documents | `PROJECT` | Trivial |
| `conversation` document + root agent document | `CONVERSATION` + `CONVERSATION_CONFIG` | Easy |
| Child agents sharing a conversation (`contextOwnerAgentId`) | Child `CONVERSATION`; records split by `agent_id` | Medium |
| Pi message records (tree via `parentId`) | `CONVERSATION_EVENT`; `parentId` → `previous_context_event_id`, leaves → active head | Medium |
| Harness messages, task, subagent and run-status entries | `system_event` | Medium |
| `model_change`, `thinking_level_change`, `active_tools_change` entries | Dropped; configuration is current-only | Trivial |
| Compaction summaries | `compaction` | Easy |
| Branch summaries | `compaction` on the branch | Easy |
| Run records and transitions | `execution_state` events (start and end) | Medium |
| Tool-call records | `tool_call_response` payload: outcome, supervision, interaction | Medium |
| `agent_inputs` | `INPUT_QUEUE`, pending only | Easy |
| `task` documents from tool promotion | `ASYNC_BASH`; terminal ones only as history in events | Easy |
| `task` documents from the UI | Dropped; launch instances are in memory | Trivial |
| Project/prompt-suggestion trust documents | `TRUSTED_RESOURCE` | Easy |
| `scratch_notes` | `SCRATCH_NOTE` | Trivial |
| Conversation-level capability overrides and approval settlements | Conversation overlay files where they represent lasting rules | Medium |
| Files on disk + `file_assets` | `ASSET` | Medium |
| `durable_events`, `conversation_state`, journal documents, `lifecycle_*`, `run_lifecycle_records`, obligations, completions, projections, `rpc_idempotency`, query cache, empty tables | Dropped | Trivial |

## Strategy

- **New file, read-only import.** Create the new schema in a fresh database and fill it with a one-shot importer that only reads the old database. The old file is the backup.
- **Per conversation.** Import one conversation tree at a time so failures are isolated and reportable.
- **Settle in-flight work first.** Unfinished runs, interactions and tool calls are imported as `cancelled` or `indeterminate` responses with matching `execution_state` events; pending approvals do not survive cutover.
- **No coexistence.** The old and new tool lifecycles are too different to run side by side. The runtime cuts over at once.
- **Rehearse on copies.** Run the importer repeatedly against copies of both homes (`pnpm storage:copy --slot N`), compare conversation counts, context projections and asset coverage, then switch `~/.nerve`.
- **After cutover**, schema changes use the [storage migration framework](../storage-migration-framework.md) on the new schema.

## Code affected

| Area | Size |
| --- | --- |
| Server domains built on the current model: `agents`, `runs`, `tools`, `conversations`, `human-input` | about 38k lines |
| Persistence and migration infrastructure | about 15k lines |
| Files querying the affected tables directly | 35 files, 9.4k lines |
| `agentId` / `runId` usage | 32 contracts files; 58 / 35 app files |
| Server tests, mostly for the replaced machinery | about 56k lines |

The app's inline display of child transcripts changes to navigation into child conversations.

## Effort

Rough single-engineer estimate:

| Workstream | Estimate |
| --- | --- |
| Workbench channel (phase 1) | 1–2 weeks |
| New schema, repositories, context projection to Pi | 1–2 weeks |
| Runtime rewrite: conversation as agent, tool-call lifecycle, queue, async bash, recovery | 4–8 weeks |
| Conversation channel, contracts and UI updates | 2–3 weeks |
| Importer and verification against copied homes | 1–2 weeks |
| **Total** | **about 2.5–4 months** |

The runtime rewrite is the largest and riskiest part; recovery and approval flows are where regressions are most likely.
