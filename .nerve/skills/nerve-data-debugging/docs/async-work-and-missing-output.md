# Async work and missing output

Use when a promoted task/subagent finishes without notifying its owner, background work remains pending, or retained output cannot be found. Complete [storage setup](storage-and-evidence.md); bind conversation, owner agent, task and tool IDs as applicable. Discover these newer tables before querying; older homes may lack them.

## Trace the completion and delivery obligation

```sql
SELECT run_id, child_id, lead_id, pending, length(data) AS payload_bytes
FROM subagent_completions
WHERE conversation_id = :conversation_id
ORDER BY run_id DESC LIMIT 50;

SELECT id, owner_agent_id, source_kind, source_id, source_agent_id, state,
       generation, notification_entry_id, created_at_ms, updated_at_ms
FROM agent_async_obligations
WHERE conversation_id = :conversation_id AND owner_agent_id = :agent_id
ORDER BY updated_at_ms DESC LIMIT 50;
```

The first query is ID-ordered, not a completion timeline (there is no timestamp column). Match the child/run and lead IDs, then follow obligation state. `pending` in `subagent_completions` is not interchangeable with obligation state.

Obligation sources are `promoted_task` and `async_subagent`; states are `pending`, `ready`, `delivered`, `consumed`, `cancelled`, `suppressed`. `ready`/`delivered` are recovery candidates. Delivery writes a notification entry; consumption follows an owner assistant descendant. Source policy may suppress delivery. A delivered notice does not itself prove the owner resumed or the client rendered it.

Find notification entries without printing their content:

```sql
SELECT o.id AS obligation_id, o.state, o.notification_entry_id,
       r.sequence, r.kind, r.agent_id, r.parent_id, r.updated_at_ms
FROM agent_async_obligations o
LEFT JOIN conversation_records r
  ON r.id = o.notification_entry_id AND r.conversation_id = o.conversation_id
WHERE o.conversation_id = :conversation_id AND o.owner_agent_id = :agent_id
ORDER BY o.updated_at_ms DESC LIMIT 50;
```

Use the setup identity query to inspect task/child/owner document statuses. For active run enqueue/wake or missing continuation, follow [stalled runs](stalled-runs-and-recovery.md); for a notice present but absent from the UI follow [storage/UI mismatch](storage-ui-mismatches.md). A transient queued notice may not yet have a persisted entry.

## Resolve retained output ownership

```sql
SELECT id, category, logical_path, conversation_id, tool_call_id, task_id,
       byte_length, media_type, digest,
       datetime(updated_at_ms / 1000, 'unixepoch') AS updated_utc
FROM file_assets
WHERE conversation_id = :conversation_id
   OR tool_call_id = :tool_call_id
   OR task_id = :task_id
ORDER BY updated_at_ms DESC
LIMIT 50;
```

Resolve `logical_path` using current storage paths/asset ownership, not guessed public-ID filenames. Check file existence and size before reading content. Reports, payloads and task logs can contain credentials or untrusted text; inspect only targeted, redacted content. Use the [bounded log workflow](storage-and-evidence.md#correlate-logs-without-exposing-payloads) for worker/completion evidence. Do not rerun a command to recover missing output.

## Stop or escalate

Report source/owner IDs, obligation generation/state, notification entry presence, task/child status, and asset metadata. Separate “source finished,” “notice persisted,” “owner consumed,” and “UI displayed.” If output was not retained or completion evidence is absent, state that limit rather than inventing a result.

Sources: canonical `schema.ts`; `packages/workbench-server/src/domains/agents/agent-async-obligation.service.ts` and `async-obligation-source-adapters.ts` in that directory. Inspect current adapter policy before attributing `suppressed` to a defect.
