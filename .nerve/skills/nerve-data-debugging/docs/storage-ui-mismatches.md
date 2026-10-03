# Storage and UI disagree

Use when persisted status/transcript differs from what the UI shows. Complete [storage setup](storage-and-evidence.md), including snapshot/incident timing and parameter binding. Storage alone cannot prove a UI bug or establish what the client received.

## Choose the owning layer

Start with the latest conversation timeline. Lifecycle authority, transcript runtime, tool projection, entity documents, query cache and client state answer different questions. For absent prompts use [missing user input](missing-user-input.md); for missing work/continuation use [stalled runs](stalled-runs-and-recovery.md).

Do not compare unlike status vocabularies:

- Public run events map `starting` to `queued`, `waiting` to `waiting_for_input`, `executing_tools` and `cancellation_requested` to `running`, and `retrying`/`interrupted`/`cancellation_failed` to `recoverable_failed`. Other statuses pass through currently.
- Run execution records use `starting`, `streaming`, `waiting`, `completed`, `failed`, `cancelled`, `superseded`, distinct from runtime status.
- Agent statuses: `idle`, `running`, `awaiting_user`, `aborted`, `error`.
- Tool-call statuses: `committed`, `waiting`, `running`, `completed`, `denied`, `failed`, `cancelled`. Phase is separate: `drafting`, `drafted`, `executing`, `completed`, `failed`, `denied`, `cancelled`, `interrupted`.
- Canonical tool record `status` may describe transcript phase. Compare executable state with `tool_call_projections.status` and `$.toolCall.status`; execution status is another layer (`running`, `waiting_for_input`, `completed`, `failed`, `cancelled`, `interrupted`).

Current mapping: `packages/workbench-server/src/domains/runs/runtime/run-events.ts` (`publicStatus`); tool shapes: `packages/contracts/src/domains/tools/records.ts`.

## Compare layers in one consistent view

Waiting runs with waiting-tool and pending-interaction counts (zero counts are leads):

```sql
SELECT r.conversation_id, r.agent_id, r.id AS run_id, r.revision,
       json_extract(CAST(r.data AS TEXT), '$.run.activeInteractionId') AS active_interaction_id,
       (SELECT count(*) FROM tool_call_projections t
         WHERE t.run_id = r.id AND t.status = 'waiting') AS waiting_tools,
       (SELECT count(*) FROM json_each(CAST(r.data AS TEXT), '$.state.interactions') j
         WHERE json_extract(j.value, '$.status') = 'pending') AS pending_run_interactions,
       datetime(r.updated_at_ms / 1000, 'unixepoch') AS run_updated_utc
FROM conversation_records r
WHERE r.conversation_id = :conversation_id
  AND r.kind = 'run' AND r.status = 'waiting'
ORDER BY r.updated_at_ms DESC
LIMIT 50;
```

Tool/run interaction revision mismatches or missing tool projections:

```sql
SELECT r.id AS run_id,
       json_extract(j.value, '$.id') AS interaction_id,
       json_extract(j.value, '$.toolCallId') AS tool_call_id,
       json_extract(j.value, '$.status') AS interaction_status,
       json_extract(j.value, '$.toolCallRevision') AS expected_revision,
       t.revision AS current_revision,
       t.status AS current_tool_status,
       t.pending_interaction_kind
FROM conversation_records r
JOIN json_each(CAST(r.data AS TEXT), '$.state.interactions') j
LEFT JOIN tool_call_projections t
  ON t.record_id = json_extract(j.value, '$.toolCallId')
WHERE r.conversation_id = :conversation_id AND r.kind = 'run'
  AND json_extract(j.value, '$.status') = 'pending'
  AND (t.record_id IS NULL
       OR t.revision IS NOT json_extract(j.value, '$.toolCallRevision')
       OR t.status <> 'waiting')
ORDER BY r.updated_at_ms DESC
LIMIT 50;
```

Agents claiming user input is needed:

```sql
SELECT document_id AS agent_id,
       json_extract(CAST(data AS TEXT), '$.conversationId') AS conversation_id,
       json_extract(CAST(data AS TEXT), '$.status') AS agent_status,
       revision,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM domain_documents
WHERE namespace = 'agent'
  AND json_extract(CAST(data AS TEXT), '$.conversationId') = :conversation_id
  AND json_extract(CAST(data AS TEXT), '$.status') = 'awaiting_user'
ORDER BY updated_at_ms DESC
LIMIT 50;
```

Treat invariant query results as leads. Some transitions are intentionally multi-step; confirm with event ordering and timestamps before calling a state stale.

## Inspect durable event order

```sql
SELECT row_id, stream, stream_sequence, event_type, record_id, record_revision,
       datetime(occurred_at_ms / 1000.0, 'unixepoch') AS occurred_utc
FROM durable_events
WHERE conversation_id = :conversation_id
ORDER BY row_id DESC
LIMIT 100;
```

Focus around one run or tool without assuming the payload's envelope:

```sql
SELECT row_id, stream_sequence, event_type, record_id, record_revision,
       datetime(occurred_at_ms / 1000.0, 'unixepoch') AS occurred_utc,
       length(data) AS payload_bytes
FROM durable_events
WHERE conversation_id = :conversation_id
  AND row_id BETWEEN :row_start AND :row_end
  AND (record_id = :tool_call_id
       OR CAST(data AS TEXT) LIKE '%' || :run_id || '%'
       OR CAST(data AS TEXT) LIKE '%' || :tool_call_id || '%')
ORDER BY row_id DESC
LIMIT 100;
```

Use the `LIKE` payload scan only after indexed filters such as `conversation_id`, a bounded `row_id` range, or a narrow time window.

## Query cache and current delivery

`cache/query-cache.sqlite` is rebuildable, not lifecycle authority. Common entity cache tables (`projects`, `conversations`, `agents`, `tasks`, `prompt_suggestion_trust`) have denormalized `json`; `query_cache_meta` instead has `key`/`value`. Discover its schema in a separate read-only connection before targeted comparisons. Canonical and cache reads do not form one transaction: record both observation times and revisions. Do not rebuild or modify the live cache just to test a hypothesis.

Compare the daemon's current snapshot, selected agent and [active branch](missing-user-input.md), then the client's subscription/replay state. Correct SQL with stale UI may be client delivery or query cache lag; connection/authentication failures require transport diagnostics first.

## Stop or escalate

Report confirmed cross-layer disagreement with IDs, statuses, revisions and event order; distinguish transient observations from stable mismatch. If the daemon snapshot is correct, move to client delivery/replay evidence in `packages/protocol` and the owning workbench feature. If only historical SQL is available, explicitly state that current daemon/client state is unknown.
