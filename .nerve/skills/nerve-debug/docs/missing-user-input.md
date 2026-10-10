# Missing approval, question, or plan review

Use when the agent appears to need user input but no prompt is visible, or a stored prompt cannot be acted on. Complete [storage setup](storage-and-evidence.md) first; bind conversation, run, tool and agent IDs.

## Investigation order

Start with the latest run, then its tool and journal interaction, then the selected branch. An `awaiting_user` agent alone is not proof of a currently renderable prompt. Approval is attached to another tool (such as `bash`), so no `ask_user` invocation does not mean no pending action.

## Check the run and hydrated interactions

```sql
SELECT id AS run_id, sequence, revision, status, run_delivery_settled_revision,
       json_extract(CAST(data AS TEXT), '$.run.executionId') AS execution_id,
       json_extract(CAST(data AS TEXT), '$.run.attempt') AS attempt,
       json_extract(CAST(data AS TEXT), '$.run.recoverability') AS recoverability,
       json_extract(CAST(data AS TEXT), '$.run.activeInteractionId') AS active_interaction_id,
       json_extract(CAST(data AS TEXT), '$.run.lastCheckpointId') AS last_checkpoint_id,
       json_extract(CAST(data AS TEXT), '$.run.failure.code') AS failure_code,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM conversation_records
WHERE conversation_id = :conversation_id AND kind = 'run'
ORDER BY sequence DESC
LIMIT 50;
```

List hydrated run interactions:

```sql
SELECT json_extract(j.value, '$.id') AS interaction_id,
       json_extract(j.value, '$.toolCallId') AS tool_call_id,
       json_extract(j.value, '$.kind') AS kind,
       json_extract(j.value, '$.status') AS status,
       json_extract(j.value, '$.toolCallRevision') AS tool_revision,
       json_extract(j.value, '$.checkpointId') AS checkpoint_id,
       json_extract(j.value, '$.createdAt') AS created_at,
       json_extract(j.value, '$.resolvedAt') AS resolved_at,
       json_extract(j.value, '$.cancelledAt') AS cancelled_at
FROM conversation_records AS r,
     json_each(CAST(r.data AS TEXT), '$.state.interactions') AS j
WHERE r.id = :run_id
ORDER BY created_at DESC
LIMIT 50;
```

## Check tool state

```sql
SELECT record_id AS tool_call_id, tool_name, status,
       pending_interaction_kind, has_interaction, has_plan_review,
       is_todo_state, revision, updated_at
FROM tool_call_projections
WHERE conversation_id = :conversation_id
ORDER BY updated_at DESC, record_id DESC
LIMIT 50;
```

Inspect one canonical tool call compactly:

```sql
SELECT id, revision, status,
       json_extract(CAST(data AS TEXT), '$.toolCall.toolName') AS tool_name,
       json_extract(CAST(data AS TEXT), '$.toolCall.status') AS tool_status,
       json_extract(CAST(data AS TEXT), '$.toolCall.phase') AS phase,
       json_extract(CAST(data AS TEXT), '$.toolCall.execution.status') AS execution_status,
       json_extract(CAST(data AS TEXT), '$.toolCall.execution.executionId') AS execution_id,
       json_array_length(CAST(data AS TEXT), '$.toolCall.interactions') AS interactions
FROM conversation_records
WHERE id = :tool_call_id;
```

Expand its interactions:

```sql
SELECT json_extract(j.value, '$.ordinal') AS ordinal,
       json_extract(j.value, '$.kind') AS kind,
       json_extract(j.value, '$.status') AS status,
       json_extract(j.value, '$.resolution.action') AS action,
       json_extract(j.value, '$.resolution.scope') AS scope,
       json_extract(j.value, '$.resolutionRequestId') AS resolution_request_id,
       json_extract(j.value, '$.requestedAt') AS requested_at,
       json_extract(j.value, '$.resolvedAt') AS resolved_at
FROM conversation_records AS r,
     json_each(CAST(r.data AS TEXT), '$.toolCall.interactions') AS j
WHERE r.id = :tool_call_id
ORDER BY ordinal
LIMIT 50;
```

Check lifecycle interaction state independently (when this table exists):

```sql
SELECT interaction_id, proposal_id, run_id, state, resolution_request_id,
       updated_at_ms
FROM lifecycle_interactions
WHERE conversation_id = :conversation_id AND run_id = :run_id
ORDER BY updated_at_ms DESC LIMIT 50;
```

## Verify actionability

A pending interaction and a waiting tool projection do not alone prove that a prompt is actionable. A run-associated tool needs loaded resident journal state in the daemon; correct SQLite state does not establish that prerequisite. In the current journal implementation, a run-associated tool interaction additionally needs:

- A matching journal interaction for tool ID and interaction ordinal.
- An `open` suspension referenced by that interaction.
- Membership of the interaction in that suspension.
- Matching suspension-member, journal-interaction, and current tool revisions.
- A non-cancelled journal interaction.

For a prompt that should still be pending, separately confirm the canonical tool interaction is pending and the tool/run belongs to the selected agent and branch. Resolving one sibling does not necessarily resolve the whole suspension/checkpoint.

## Locate the canonical journal snapshot and tail

Journal hydration reads the `conversation_state` snapshot, newer `conversation_journal_commit` documents, and the `conversation_journal_head`. Checkpointing removes covered commits; their absence is not missing history.

```sql
SELECT namespace, document_id, revision, payload_version,
       length(data) AS payload_bytes, updated_at_ms
FROM domain_documents
WHERE scope_id = :conversation_id
  AND namespace IN ('conversation_state', 'conversation_journal_head')
ORDER BY namespace LIMIT 10;

SELECT document_id, revision, length(data) AS payload_bytes, updated_at_ms
FROM domain_documents
WHERE namespace = 'conversation_journal_commit' AND scope_id = :conversation_id
  AND CAST(document_id AS INTEGER) > COALESCE(
    (SELECT revision FROM domain_documents
     WHERE namespace = 'conversation_state' AND scope_id = :conversation_id
       AND document_id = 'state'), 0)
ORDER BY document_id LIMIT 50;
```

The second query starts at the snapshot boundary; if more than 50 tail documents exist, continue deliberately rather than treating this as the entire journal. Reconstruct snapshot plus tail with the current journal schemas; metadata alone cannot establish suspension membership. Inspect top-level keys first, then only IDs, revisions, statuses and members. Journal interactions nest the tool interaction under `interaction`, unlike hydrated run interactions. Verify against `packages/contracts/src/domains/conversations/conversation-journal.ts`, the journal repository, and `packages/workbench-server/src/infrastructure/persistence/canonical-sqlite/canonical-database.ts` (`readConversationJournal`). Hydration also verifies the head; do not equate unrelated revision counters.

Durable journal events corroborate reconstruction using [event ordering](storage-ui-mismatches.md#inspect-durable-event-order). Current journal commits use `{version: 1, events: [...]}`. Locate `interaction.upserted` and `suspension.upserted` and inspect only relevant metadata; widen the window if the suspension predates it.

Check the agent's context leaf:

```sql
SELECT l.conversation_id, l.agent_id, l.active_record_id, l.revision,
       r.kind AS leaf_kind, r.parent_id, r.run_id
FROM agent_context_leaves l
LEFT JOIN conversation_records r ON r.id = l.active_record_id
WHERE l.conversation_id = :conversation_id AND l.agent_id = :agent_id;
```

Follow `parent_id` in bounded steps to inspect branch ancestry; do not assume the newest record belongs to the active branch. If persisted actionability is consistent but the prompt is absent, compare the daemon's current snapshot/selected agent and the client's delivered state. SQLite cannot establish what the client actually received or rendered.

## Stop or escalate

If pending tool/run state and suspension membership disagree in a consistent snapshot, report the exact IDs and revisions with surrounding events. If persisted state is consistent, check daemon resident journal state and its current snapshot before investigating client replay/rendering. Do not repair the database.

Current actionability predicate: `packages/workbench-server/src/domains/conversations/conversation-journal.repository.ts` (`isActionableToolInteraction`). It checks non-cancellation, not selected branch or pending status; those are separate checks above.
