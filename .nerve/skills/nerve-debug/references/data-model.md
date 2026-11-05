# Nerve persistence model (conversation core)

Read this when you need to interpret a row, state or event. Verify details in the source files listed at the end. Source code and contracts take precedence over this page.

## Mental model

- **The conversation is the agent.** A sub-agent is a child `conversation` row (`parent_conversation_id`, `parent_tool_call_id` = the `subagent_prompt` call). Its `title` is the sub-agent name. There are no separate agent, run or task tables.
- **Tables hold current state and unfinished work. Events hold facts.** When a tool call settles, the core appends a `tool_call_response` event and deletes the `tool_call` row in the same transaction. When an input is delivered, the core appends an event and deletes the `input_queue` row. A missing row is normal; a row that should be gone is the anomaly.
- **History is a branchable event tree.** `previous_event_id` links each event to its predecessor. `conversation.head_event_id` selects the active branch, which is the transcript and model context. `sequence` orders replay across **all** branches.
- **Configuration lives in files, not SQLite.** It is in `data/conversations/<conv>/config/*.json` plus user and project scopes. Only `working_directory` is a column.
- **Live progress is memory-only.** Streaming text, tool progress, process handles, launch runs and the "input being processed" flag are not persisted. A restart loses them by design.
- **External effects are not exactly-once.** An interrupted non-replay-safe tool settles as `indeterminate`. Never rerun it to find out what happened.

Timestamps are ISO-8601 UTC **text** columns, so compare them as strings. IDs are prefixed ULIDs (`conv_`, `evt_`, `tool_`, `turn_`, `proj_`). An assistant `toolCall` block carries the provider's ID (such as `toolu_…`). The core tool ID (`tool_…`) is in `tool_call.id` and in `tool_call_response.payload.toolCallId`; the two IDs are linked through `provider_call_id`.

## Tables (schema v3)

| Table                    | Holds                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`                | `id, name, directory`                                                                                                                                                                                                                                         |
| `conversation`           | identity, parent, `head_event_id`, `title`, stored `status` + `status_event_sequence`, `status_cleared_at`, `paused`, `completed_at` (marked done by the user), `working_directory`                                                                           |
| `conversation_event`     | `sequence`, `previous_event_id`, `event_type`, `llm_representation`, `turn_id`, `input_id`, JSON `payload`, `created_at`                                                                                                                                      |
| `tool_call`              | **unfinished** calls only: `state`, `tool_name`, `arguments`, `origin` (`model`/`user`), `supervision` JSON, `interaction` JSON, `execution_claim`, `turn_id`, `assistant_event_id`                                                                           |
| `input_queue`            | accepted but undelivered inputs: `source` (`user`/`parent_conversation`/`system`), `content` (text or a notice object), `delivery_target` (`next_turn`/`specific_execution`/`next_execution`), `target_execution_id`, `wake_when_idle`, `acceptance_sequence` |
| `async_bash`             | background commands: `status` (`running`/`completed`/`failed`/`timed_out`/`cancelled`/`lost`), `tool_call_id`, `exit_code`, `process_ref`                                                                                                                     |
| `asset`                  | managed files: `category` (`payload`/`report`/`image`/`plan`/`bash_output`), `logical_path` relative to `<home>/data/`, `byte_length`, owners `event_id`/`tool_call_id`/`async_bash_id`                                                                       |
| `conversation_reference` | external resources a conversation referenced or created (GitHub and similar)                                                                                                                                                                                  |
| `trusted_resource`       | digest-bound trust decisions for skills, profiles, project permissions and suggestions                                                                                                                                                                        |
| `scratch_note`           | project notes (not agent history)                                                                                                                                                                                                                             |
| `schema_migrations`      | applied core SQL steps with checksums                                                                                                                                                                                                                         |

## Events

| `event_type`         | Payload highlights                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`       | `text`, `source` (`user`/`parent_conversation`), `senderConversationId`, `acceptedAt`; `input_id` column = submission identity                                                                                  |
| `assistant_message`  | `content[]` (`text`/`thinking`/`toolCall{id,name,arguments}`), `stopReason` (`stop`/`toolUse`/`length`/`error`/`aborted`/`deferred`/`pending`), `provider`, `model`, `errorMessage`, `usage`                    |
| `tool_call_response` | `toolCallId`, `toolName`, `outcome` (`completed`/`failed`/`denied`/`cancelled`/`indeterminate`), `supervision`, `interactionResolution`, `resolutionRequestId`, `agentProjection`, `userProjection`, `assetIds` |
| `system_event`       | `subtype` = `execution_state` (see below), or a delivered notice: `task_result` (`task` = `{kind: bash, id, exitCode}` or `{kind: subagent, id, assignmentId}`, `outcome`), `user_intervention`, `notification` |
| `compaction`         | `summary`, `firstKeptEventId`, `tokensBefore`; original events stay in the tree                                                                                                                                 |

**Executions.** An execution is a span of turns. It begins with `execution_state/started`, and the ID of that event _is_ the execution ID. Later transitions carry `executionId` and are one of `waiting` (with `waiting.toolCallId` or `waiting.childConversationId`), `retrying` (`retry.attempt/maxAttempts/error`), `completed`, `failed` (`failure.message/category`), `cancelled` or `interrupted`. An execution is **open** when the latest `execution_state` event, ordered by `sequence` regardless of branch, is `started`, `waiting` or `retrying`. Recovery appends `interrupted` for an open execution that has no unfinished tool rows.

A **turn** is one model request plus its tool calls, and they share a `turn_id`. The next turn waits until no `tool_call` rows remain for the current turn (the turn barrier).

## Tool-call states

`supervising → ready → running → (settled)`, with waits at `awaiting_approval` and `awaiting_input`. The `interaction.kind` field is `approval`, `user_input` (ask_user), `plan_review` or `configuration_blocked`. Configuration-blocked calls wait in `awaiting_input`. An interaction with `resolution` set has been answered but not yet applied. `execution_claim` fences which worker may settle a running call. After restart, recovery re-admits waiting and ready calls under current policy. A `running` call is retried only if its tool is replay-safe; otherwise it settles as `indeterminate`.

## Conversation status (derived, then stored)

`StatusService.refresh` computes the status in this order:

1. Any `awaiting_approval` or `awaiting_input` row → `waiting`.
2. Otherwise, an open execution, any tool row, or **in-memory input processing** → `running`.
3. Otherwise, the latest `execution_state` is `failed` or `interrupted` and newer than `status_cleared_at` → that value.
4. Otherwise → `idle`.

The SQL-only derivation (`nerve_debug.py overview/check`) cannot see the in-memory flag, so a brief `running` versus `idle` difference can be legitimate.

The `pendingWork` and `pendingInput` summary fields are computed when read across the descendant tree, not stored. That is why a root conversation can show attention for a child's question.

## Files in a home

```
<home>/manifest.json                 home format + applied home migration steps
<home>/daemon.json                   running daemon: pid, port, url, dataDir, version (never print tokens)
<home>/config/*.json                 user settings (daemon.json has logging.level, default "warn")
<home>/data/nerve.sqlite(-wal,-shm)  core database
<home>/data/conversations/<conv>/config/agent.json      applied profile snapshot, overrides, frozen child defaults
<home>/data/conversations/<conv>/tool-calls/<tool>/...  result.json (payload), files/stdout.txt etc. (report)
<home>/data/conversations/<conv>/async-bash/<bash>/...  background output
<home>/data/{images,plans,agent-profiles,launches}/
<home>/logs/application-YYYY-MM-DD.jsonl   daemon log (fields: ts, level, source, component, message, context, error, conversationId?)
<home>/logs/desktop-YYYY-MM-DD.jsonl       desktop shell log; startup.jsonl; performance-*.jsonl
<home>/crashes/                             crash reports
<home>/migrations/{last-failure.json,reports/,work/}   upgrade failures and set-aside reports
<home>/quarantine/                          set-aside sources from migrations and settings resets
<home>/secrets/, <home>/tls/                never read or print
```

Logs keep 14 days by default at level `warn`. Most lifecycle steps are **not** logged, and deleting a conversation also removes log lines tagged with its `conversationId`. A missing log line proves nothing. Renderer errors appear as `component: web-runtime`. Unreadable conversations log `"Conversation read failed; skipped"` with `context.operation`.

## Source of truth

- Schema: `packages/conversation-core/src/storage/schema.ts`, `schema-v2.ts`, `schema-v3.ts`, `migrations.ts`
- Shapes: `packages/contracts/src/domains/core/{event,tool-call,input,conversation}.ts`
- Status and executions: `packages/conversation-core/src/runtime/status.ts`
- Recovery: `packages/conversation-core/src/runtime/recovery.ts`, `tool-calls/tool-call.service.ts` (`recover`), `async-bash/async-bash.service.ts` (`recover`)
- Settlement and barrier: `packages/conversation-core/src/tool-calls/tool-call-settlement.service.ts`
- Queue: `packages/conversation-core/src/inputs/input-queue.service.ts`
- Delegation: `packages/conversation-core/src/delegation/`
- Paths: `packages/workbench-server/src/infrastructure/storage-bootstrap/paths.ts`
- Architecture: `docs/architecture/conversation-core/*.md`, `docs/architecture/storage.md`, `docs/architecture/conversation-state-and-attention.md`
