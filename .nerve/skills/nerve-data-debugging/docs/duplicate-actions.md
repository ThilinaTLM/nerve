# Duplicate or retried actions

Use when a mutation appears repeated, an interaction resolves twice, or an external action may have run twice. Complete [storage setup](storage-and-evidence.md); obtain actual request IDs and scopes from targeted protocol/lifecycle evidence. Bind `:scope_id` and `:request_id` for the specific layer being queried; they may differ between layers.

## Check receipts first

For a duplicate action, obtain the actual scope and request IDs from matching protocol/lifecycle evidence; do not assume scope equals conversation ID:

```sql
SELECT scope_id, request_id, input_hash, payload_version, created_at_ms
FROM lifecycle_command_receipts
WHERE scope_id = :scope_id AND request_id = :request_id;

SELECT scope, key, method, params_hash, created_at_ms, expires_at_ms
FROM rpc_idempotency
WHERE scope = :scope_id AND key = :request_id;
```

These are separate deduplication layers and may use different scopes/keys. Missing RPC receipts can reflect expiry, not proof that a request never ran. Inspect targeted receipt fields only after verifying payload shape; outcomes may contain sensitive data.

## Trace interaction and execution generations

```sql
SELECT interaction_id, proposal_id, run_id, state, resolution_request_id,
       updated_at_ms
FROM lifecycle_interactions
WHERE conversation_id = :conversation_id
  AND resolution_request_id = :request_id
ORDER BY updated_at_ms DESC LIMIT 50;

SELECT a.attempt_id, a.proposal_id, p.invocation_id, a.run_id,
       a.state, a.generation, a.result_entry_id, a.updated_at_ms
FROM lifecycle_execution_attempts a
JOIN lifecycle_tool_proposals p ON p.proposal_id = a.proposal_id
WHERE p.conversation_id = :conversation_id AND a.run_id = :run_id
ORDER BY a.updated_at_ms DESC LIMIT 50;
```

Correlate attempts with [work/recovery](stalled-runs-and-recovery.md) and [durable event ordering](storage-ui-mismatches.md#inspect-durable-event-order). A retried request, duplicate event delivery, second attempt generation, and duplicate external side effect are different findings. Hashes/receipts can establish deduplication inputs but do not alone establish what an external system did.

## Stop or escalate

Report scope/request IDs, receipt presence and timestamps, interaction resolution IDs, attempt generations and known results. If the external effect remains uncertain, request provider/worker evidence; do not rerun to find out. Never dump receipt outcome payloads or RPC parameters.

Sources: `packages/workbench-server/src/infrastructure/persistence/canonical-sqlite/schema.ts` and `lifecycle-work-database.ts` in that directory; protocol retries/replay belong to `packages/protocol`.
