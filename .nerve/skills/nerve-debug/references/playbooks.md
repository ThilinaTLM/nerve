# Symptom playbooks

Each playbook assumes you already ran `overview`, `check` and `timeline` for the conversation (see SKILL.md). `$D` means `python3 <skill>/scripts/nerve_debug.py --home <home>`. SQL runs with `sqlite3 -readonly <db>`; replace `<…>` placeholders with literal IDs (unbound `:named` parameters in the sqlite3 shell silently match nothing). Field meanings are in [data-model.md](data-model.md).

## 1. Stuck running

Status `running` means an open execution, an unfinished tool row, or in-memory input processing.

1. In `overview`, find which condition holds: the open execution (`latest execution_state … [OPEN]`), open tool rows, or neither. Neither means memory-only processing; re-check after a moment.
2. If a tool row is `running` with `claimed=1`, run `$D tool <tool_id>` and the `logs <tool_id>` command. Long-running bash is normal unless its time budget passed. A `ready` row that never advances suggests the scheduler never resumed. Look for an earlier recovery failure in the logs.
3. If the execution is open and there are **no tool rows**, the last event is usually `retrying`, an assistant message mid-turn, or a `started` with nothing after it. A daemon restart should append `interrupted` (see `recoverCore`). If the daemon restarted and the execution is still open, that is a real lead. Confirm the restart time with `logs --since` and by reading `<home>/logs/startup.jsonl` directly (the helper does not parse it).
4. Check children: a parent with `waiting.childConversationId` is waiting for that child, so follow section 3.
5. Report the last durable transition (event seq/time) and what should have followed it.

## 2. Missing or non-actionable prompt

Prompts are `tool_call` rows in `awaiting_approval` or `awaiting_input` with an `interaction`. They can belong to a **descendant**: the root shows `pendingInput` for the oldest one in its tree.

1. Run `$D overview <conv>` on the conversation **and each running child** to find the waiting row.
2. Run `$D tool <tool_id>` to see the interaction `kind`, `resolved`, `resolutionRequestId` and supervision.
   - No row, but a `tool_call_response` exists: the prompt was already settled. Read `outcome` and `resolution=` in the timeline.
   - `resolved` is true but the row still waits: the resolution was recorded but not applied. This is a real lead; check the logs for the request ID.
   - A `configuration_blocked` interaction is resolved by Retry after fixing configuration, not by approving.
   - A `plan_review` acceptance binds to the profile digest and config revision. A changed `agent.json` (`revision`) requires reconfirmation, which is expected.
3. Children never get approval prompts. A child that seems to need input means a policy or configuration problem, not a hidden prompt.
4. After a restart, approvals and configuration waits are re-evaluated under current policy and may disappear or turn into `denied`. Ordinary questions stay pending.
5. If storage shows a pending interaction but the UI does not, go to section 10.

All waiting prompts across the home:

```sql
SELECT c.id AS conversation, c.parent_conversation_id AS parent, t.id AS tool, t.tool_name, t.state,
       json_extract(t.interaction,'$.kind') AS kind, t.updated_at
FROM tool_call t JOIN conversation c ON c.id = t.conversation_id
WHERE t.state IN ('awaiting_approval','awaiting_input') ORDER BY t.updated_at LIMIT 50;
```

## 3. Sub-agents

Flow: the lead's `subagent_prompt` creates or reuses a child (case-insensitive name) and queues a `parent_conversation` input. The child runs. On a terminal execution, the core queues a `task_result` system input to the lead with `wake_when_idle`. The lead receives it as a `system_event` notice.

1. Run `$D tool <subagent_prompt tool_id>`. It lists the children it created. Follow-ups reuse existing children, so also look at the lead's `overview` children list.
2. For each child, run `overview` and `timeline`. Did its execution reach `completed`, `failed`, `cancelled` or `interrupted`? Did it get the parent input as a `user_message` with `source=parent_conversation`?
3. In the lead, check `input_queue` (is the notice queued but undelivered?) and the timeline (was it delivered as `notice task_result`?).
   - Queued with the lead `paused=1`: notices respect pause. Stopping the lead pauses it and cascades.
   - Queued on an idle, unpaused lead with `wake=1`: the wake was lost. This is a real lead.
   - No notice at all: an explicit stop or cascade suppresses cancellation notices by design. Otherwise, check whether the child execution actually ended.
4. A child `running` under a paused lead should not happen after a stop. `check` flags it. (Deleting a lead deletes its children.)

```sql
-- Notices delivered to a lead for one child
SELECT sequence, id, created_at, json_extract(payload,'$.outcome') AS outcome, json_extract(payload,'$.task.assignmentId') AS assignment
FROM conversation_event
WHERE conversation_id = '<lead_conv_id>' AND event_type = 'system_event'
  AND json_extract(payload,'$.subtype') = 'task_result'
  AND json_extract(payload,'$.task.id') = '<child_conv_id>'
ORDER BY sequence DESC LIMIT 20;
```

## 4. Async bash and launches

- **Async bash** is owned by the conversation. Its terminal status and its `task_result` notice commit together. A `running` row after a daemon restart becomes `lost` (notice outcome `interrupted`) during recovery (native handles cannot be reattached). That is expected, not a bug, and must never be rerun automatically.
  1. Run `$D tool <bash tool_id>` (shows the `async_bash` row and assets) or check `overview`'s async_bash list.
  2. If the status is terminal, look for the notice in the queue (undelivered) or the timeline (delivered). The notice wakes only an unpaused conversation.
  3. Output is in `asset` rows with `async_bash_id`; open them through `asset.logical_path` (relative to `<home>/data/`, usually under `conversations/<conv>/tool-calls/<tool_call_id>/`).
- **Launches** are owned by the workbench, and run records are **memory-only**. After a restart, the initiating conversation is never notified, by design. Definitions are in `<project>/.nerve/launches/definitions.json`; log bundles persist in `<home>/data/launches/<run>/`.

## 5. Input delivery

Input IDs deduplicate across pending rows and delivered events (`conversation_event.input_id`), but **not** across cancelled ones. Delivery appends the event and deletes the queue row atomically.

```sql
SELECT 'queued' AS where_, input_id, accepted_at AS at FROM input_queue WHERE input_id = '<input_id>'
UNION ALL
SELECT 'delivered', input_id, created_at FROM conversation_event WHERE input_id = '<input_id>';
```

- Stuck in the queue: check `paused`, `delivery_target`/`target_execution_id` (it waits for that execution's boundary), unfinished tool rows (they block delivery), and `wake_when_idle=0` (accepted without waking). Child conversations reject direct user input.
- Delivered twice: compare the `input_id` values. Different IDs mean two submissions, so the client resent with a new ID.
- Missing after cancel: a cancelled input leaves no trace by design.

## 6. Transcript and branches

- The transcript is the path from `head_event_id`. The timeline marks it with `*`/`H`. Events without a mark are on other branches. They still exist and still replay to clients by `sequence`.
- `(prev=…)` in the timeline marks a fork: the event's predecessor is not the previous sequence.
- Compaction appends a summary. Original events remain, and model context starts at `firstKeptEventId`.
- Head selection requires a quiet runner with no tool rows. Selecting an older head never undoes effects or reverts configuration.
- The provider sees results in assistant-block order. Missing responses become synthetic "interrupted" results in context only, not in storage.

## 7. Tool results and side effects

1. Run `$D tool <tool_id>` to see the outcome, assets and file existence/size.
2. `payload` (`result.json`) is the complete result. `report` files are captured streams. `MISSING` or `SIZE MISMATCH` is real damage or deletion. Orphan cleanup only removes assets with no pending producer.
3. `indeterminate` means a running non-replay-safe call was interrupted, and the effect is unknown. Look for external evidence (git state, the remote system, files) and report "unknown" rather than guessing. Never rerun the tool.
4. Suspected duplicate: two `tool_call_response` events for the same `toolCallId` would be a real bug. Two different tool IDs with equal arguments are two model requests. Check their `turn_id`s and the assistant events.

## 8. Provider failures

- In the timeline, look for `assistant_message` `stop=error` with `errorMessage`, `execution retrying` (`attempt/max`, `exhausted`), and `execution failed` with `failure[category]`.
- Model and credential resolution are host concerns (`packages/workbench-server/src/core-host/model.adapter.ts`). Check `logs --since <time> --level warn,error`.
- The status remains `failed` until a new execution starts or the user clears it (`status_cleared_at`).

## 9. Unreadable conversations and upgrades

- "N conversations couldn't be loaded": a row or event fails the current contracts. Find it with `logs --level warn` and the message `Conversation read failed; skipped` (`context.operation` = `get`, `recovery`, `status.refresh` …). Use `timeline` with `--preview 0` on that conversation, then look for the invalid payload with bounded SQL (`json_valid(payload)` is enforced, so it is a shape problem). Never edit the row; the supported fix is Delete or a code fix.
- Daemon does not start after an upgrade: read `<home>/migrations/last-failure.json`, `migrations/reports/*.json`, and `manifest.json` (applied home steps). Set-aside data is under `<home>/quarantine/` (managed files under `<home>/data/quarantine/files/`). See `docs/architecture/migrations.md`.
- Invalid settings: the settings-health notice applies; preserved bytes are in `quarantine/`. See `docs/architecture/storage.md#settings-health`.

## 10. UI versus storage

1. Compare the stored and derived status (`overview`). A difference with no in-memory explanation means `refresh` was skipped or failed (look for a `status.refresh` failure log).
2. Storage correct, UI wrong: the issue is in delivery or rendering. The conversation channel replays durable events by `sequence` and refetches snapshots on reconnect. Live progress is discarded. Look for `web-runtime` and `websocket` errors in `logs --since`, then the client owners in `docs/architecture/conversation-core/channels.md` and `conversation-state-and-attention.md`.
3. Attention, badges and "unseen" markers are session-local client state with nothing in storage. Reload the window before suspecting the server.
4. SQL cannot show what a client received. Say so explicitly, and reproduce on a dev slot if needed.
