# Nerve persistence model (conversation core)

Read this when you need to interpret a row, state or event. Verify details in the source files listed at the end. Source code and contracts take precedence over this page.

## Mental model

- **The conversation is the agent.** A sub-agent is a child `conversation` row (`parent_conversation_id`, `parent_tool_call_id` = the `subagent_prompt` call). Its `title` is the sub-agent name. There are no separate agent, run or task tables.
- **Tables hold current state and unfinished work. Events hold facts.** When a tool call settles, the core appends a `tool_call_response` event and deletes the `tool_call` row in the same transaction. When an input is delivered, the core appends an event and deletes the `input_queue` row. A missing row is normal; a row that should be gone is the anomaly.
- **History is a branchable event tree.** `previous_event_id` links each event to its predecessor. `conversation.head_event_id` selects the active branch, which is the transcript and model context. `sequence` orders replay across **all** branches.
- **Configuration lives in files, not SQLite.** It is in `data/conversations/<conv>/config/*.json` plus user (`<home>/config/`) and project (`<project>/.nerve/config/`) scopes. Only `working_directory` is a column. **Trust decisions and extension accounts are the exception: they live in SQLite** (`trusted_resource`, `account`), never in files.
- **Live progress is memory-only.** Streaming text, tool progress, process handles, launch run state and the "input being processed" flag are not persisted. A restart loses them by design.
- **External effects are not exactly-once.** An interrupted non-replay-safe tool settles as `indeterminate`. Never rerun it to find out what happened.

Timestamps are ISO-8601 UTC **text** columns, so compare them as strings. IDs are prefixed ULIDs (`conv_`, `evt_`, `tool_`, `turn_`, `proj_`, `bash_`). Conversations converted from pre-0.35 homes can keep unprefixed directory names under `data/conversations/`; account ids are UUIDs or legacy names. Always resolve files through `asset.logical_path`. An assistant `toolCall` block carries the provider's ID (such as `toolu_…`). The core tool ID (`tool_…`) is in `tool_call.id` and in `tool_call_response.payload.toolCallId`; the two IDs are linked through `provider_call_id`.

## Tables (core schema v5)

Core SQL steps (`schema_migrations`): 1 foundation, 2 agent profiles, 3 remove command preparation, 4 trust decisions v3, 5 accounts. This ledger is separate from the **home** ledger in `manifest.json` (see Files). Check the live schema with `sqlite3 -readonly <db> .schema <table>` when a column matters.

| Table                    | Holds                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`                | `id, name, directory`                                                                                                                                                                                                                                                                                                                                     |
| `conversation`           | identity, `project_id`, parent, `head_event_id`, `title`, stored `status` (`idle`/`running`/`waiting`/`failed`/`interrupted`) + `status_event_sequence`, `status_cleared_at`, `paused`, `next_input_sequence`, `pinned_at`, `completed_at` (marked done by the user), `last_user_message_at`, `working_directory`                                         |
| `conversation_event`     | `sequence`, `previous_event_id`, `event_type`, `llm_representation`, `turn_id`, `input_id`, JSON `payload`, `created_at`                                                                                                                                                                                                                                  |
| `tool_call`              | **unfinished** calls only: `state`, `tool_name`, `arguments`, `origin` (`model`/`user`), `supervision` JSON, `interaction` JSON, `execution_claim`, `turn_id`, `assistant_event_id`                                                                                                                                                                       |
| `input_queue`            | accepted but undelivered inputs: `source` (`user`/`parent_conversation`/`system`), `content` (text or a notice object), `delivery_target` (`next_turn`/`specific_execution`/`next_execution`), `target_execution_id`, `wake_when_idle`, `acceptance_sequence`                                                                                             |
| `async_bash`             | background commands: `status` (`running`/`completed`/`failed`/`timed_out`/`cancelled`/`lost`), `tool_call_id`, `command`, `working_directory`, `exit_code`, `process_ref`, `started_at`/`finished_at`                                                                                                                                                     |
| `asset`                  | managed files: `category` (`payload`/`report`/`image`/`plan`/`bash_output`), `logical_path` relative to `<home>/data/`, `digest`, `byte_length`, `media_type`, owners `event_id`/`tool_call_id`/`async_bash_id`                                                                                                                                           |
| `conversation_reference` | external resources a conversation referenced or created: `provider`, `resource_key`, `kind`, `relationship` (`referenced`/`created`), `source_event_id`                                                                                                                                                                                                   |
| `trusted_resource`       | digest-bound trust decisions, user (`project_id` NULL) and project level: `kind` (`prompt_suggestion`, `permissions`, `capabilities`, `permission_rule_set`, `agent_profile`, `skill`, `extension`, `mcp_server`; validated in code, not SQL), `resource_key`, `content_digest` (`sha256:<hex>`), `status` (`trusted`/`rejected`), optional `grants` JSON |
| `account`                | extension accounts (replaced `config/accounts.json` in home step 0006): `kind` (account definition id, not a FK), `project_id` (NULL = user level), `name`, `fields` JSON, `credential` (encrypted blob; **never select or print it**), `status` (`ready`/`needs_sign_in`/`failed`), `expires_at`, `last_used_at`. `unavailable` is derived on read       |
| `scratch_note`           | project notes (not agent history)                                                                                                                                                                                                                                                                                                                         |
| `schema_migrations`      | applied core SQL steps with checksums                                                                                                                                                                                                                                                                                                                     |

## Events

| `event_type`         | Payload highlights                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`       | `text`, `source` (`user`/`parent_conversation`), `senderConversationId`, `acceptedAt`; `input_id` column = submission identity                                                                                                                                                                                        |
| `assistant_message`  | `content[]` (`text`/`thinking`/`toolCall{id,name,arguments}`), `stopReason` (`stop`/`toolUse`/`length`/`error`/`aborted`/`deferred`/`pending`), `provider`, `model`, `errorMessage`, `usage`                                                                                                                          |
| `tool_call_response` | `toolCallId`, `toolName`, `outcome` (`completed`/`failed`/`denied`/`cancelled`/`indeterminate`), `supervision`, `interactionResolution`, `resolutionRequestId`, `agentProjection`, `userProjection`, `assetIds`                                                                                                       |
| `system_event`       | `subtype` = `execution_state` (see below), or a delivered notice: `task_result` (`task` = `{kind: bash, id, exitCode}` or `{kind: subagent, id, assignmentId}`, `outcome` = `completed`/`failed`/`cancelled`/`timed_out`/`interrupted`), `user_intervention`, `notification`; or `fork` (heads a forked conversation) |
| `compaction`         | `summary`, `firstKeptEventId`, `tokensBefore`; original events stay in the tree                                                                                                                                                                                                                                       |

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

Areas are chosen by who writes them: `agent/` authored resources, `config/` settings documents, `data/` Nerve-owned state, the rest operational (`docs/architecture/storage.md#home-layout`). Exact paths: `storagePaths()` in `paths.ts`.

```
<home>/manifest.json                 {format: "nerve-home", version: 2, homeClass, migrations: [{id, checksum, appliedAt}]} = home ledger
<home>/daemon.json                   running-daemon lease: pid, port, url, dataDir, version (never print tokens)
<home>/config/                       user settings documents (schema + revision; settings health applies):
    agent.json, conversation-defaults.json, daemon.json (logging, network), ui.json, permissions.json,
    providers.json, extensions.json, mcp.json, rule-sets/      (accounts.json is legacy: removed by home step 0006)
<home>/agent/{AGENTS.md,SYSTEM.md,APPEND_SYSTEM.md}           user prompt files
<home>/agent/{agent-profiles,extensions,skills,suggestions}/   user authored resources (not state; data/agent-profiles is pre-0006)
<home>/data/nerve.sqlite(-wal,-shm)  core database
<home>/data/conversations/<conv>/config/{agent,extensions}.json   applied profile snapshot, overrides, frozen child defaults
<home>/data/conversations/<conv>/tool-calls/<tool_call_id>/   result.json (payload), files/… (reports, plans, images)
<home>/data/conversations/<conv>/async-bash/<bash_id>/        background command output.txt (bash_output assets)
<home>/data/conversations/<conv>/{reports,quick-script}/      conversation reports and quick_script artifacts
<home>/data/{images,plans}/          pasted images and plans
<home>/data/extension-store/<extension>/<project>/<key>.json   durable extension values
<home>/data/launches/<run>/          launch log bundles (persist; run state itself is memory-only)
<home>/data/quarantine/files/        set-aside managed files
<home>/logs/application-YYYY-MM-DD.jsonl   daemon log (fields: ts, level, source, component, message, context, error, conversationId?)
<home>/logs/desktop-YYYY-MM-DD.jsonl       desktop shell log; startup.jsonl; performance-*.jsonl; access-audit.jsonl (auth events)
<home>/crashes/                      crash reports
<home>/migrations/{last-failure.json,reports/,work/}   upgrade failures, per-step reports, scratch
<home>/quarantine/                   set-aside sources from migrations and settings resets (settings under quarantine/settings/)
<home>/backups/storage/              storage backups
<home>/cache/, <home>/tmp/           rebuildable (usage caches, query-cache.sqlite)
<home>/secrets/, <home>/tls/         never read or print (master.key, credentials.enc, daemon-token, devices.json, vapid-keys.json)
```

Project side: `<project>/.nerve/config/{agent,permissions,extensions,mcp,conversation-defaults}.json` and `<project>/.nerve/{skills,suggestions,agent-profiles,extensions,launches}/`. Project files take effect only while a matching `trusted_resource` row (by digest) exists.

### Home migration steps

`manifest.json` lists applied steps (code: `packages/workbench-server/src/infrastructure/migrations/steps/`). The supported baseline is 0.34.1; older homes are refused.

| Step                            | Released | Does                                                                                                  |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `0001-conversation-core`        | 0.35.0   | replaces the legacy DB (`state.sqlite`, `tasks/`) with core v1 `nerve.sqlite`; manifest v1 → v2       |
| `0002-agent-profiles`           | 0.38.0   | agent settings into config files; core SQL v2 runs on next open                                       |
| `0003-process-output-files`     | 0.39.1   | builds one `output.txt` per background command                                                        |
| `0004-task-result-notices`      | 0.40.0   | `async_bash_event`/`sub_conversation_event` notices → one `task_result`                               |
| `0005-extension-settings`       | 0.41.0   | accounts → `config/accounts.json` by kind; `tools.*` → `extensions.*`; removed tools' rules converted |
| `0006-agent-resource-layout`    | 0.42.0   | `data/agent-profiles/` → `agent/agent-profiles/`; `accounts.json` → `account` table                   |
| `0007-user-configuration-trust` | draft    | trust kinds renamed (`project_*` → neutral); `trusted` rows for existing user resources               |

The registry metadata (`migrations/framework/registry-metadata.ts`) is authoritative for stages and release versions.

Application logging is off by default (`diagnostics.loggingEnabled` or `NERVE_LOGGING_ENABLED`); when on, logs keep 14 days at level `info`. Always locate output files through `asset.logical_path` rather than guessing paths. Most lifecycle steps are **not** logged, and deleting a conversation also removes log lines tagged with its `conversationId`. A missing log line proves nothing. Renderer errors appear as `component: web-runtime`. Unreadable conversations log `"Conversation read failed; skipped"` with `context.operation`.

## Source of truth

- Schema: `packages/conversation-core/src/storage/schema.ts`, `schema-v2.ts` … `schema-v5.ts`, `migrations.ts`
- Trust and accounts: `packages/contracts/src/domains/core/trusted-resource.ts`, `docs/architecture/trust.md`, `packages/conversation-core/src/storage/account.repository.ts`
- Home migrations: `packages/workbench-server/src/infrastructure/migrations/`, `docs/architecture/migrations.md`
- Shapes: `packages/contracts/src/domains/core/{event,tool-call,input,conversation}.ts`
- Status and executions: `packages/conversation-core/src/runtime/status.ts`
- Recovery: `packages/conversation-core/src/runtime/recovery.ts`, `tool-calls/tool-call.service.ts` (`recover`), `async-bash/async-bash.service.ts` (`recover`)
- Settlement and barrier: `packages/conversation-core/src/tool-calls/tool-call-settlement.service.ts`
- Queue: `packages/conversation-core/src/inputs/input-queue.service.ts`
- Delegation: `packages/conversation-core/src/delegation/`
- Paths: `packages/workbench-server/src/infrastructure/storage-bootstrap/paths.ts`
- Architecture: `docs/architecture/conversation-core/*.md`, `docs/architecture/storage.md`, `docs/architecture/conversation-state-and-attention.md`
