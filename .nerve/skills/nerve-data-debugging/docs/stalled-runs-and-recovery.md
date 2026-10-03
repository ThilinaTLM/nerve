# Stalled runs and restart recovery

Use when a tool never starts, results are stored but continuation is missing, or a run stays stuck after restart. Complete [storage setup](storage-and-evidence.md); bind conversation, run and observation-time parameters. For missing task/subagent notices use [async work](async-work-and-missing-output.md).

## Start with the last durable transition

Read the latest conversation timeline from setup. Inspect run status/checkpoint without dumping hydrated state:

```sql
SELECT id, status, revision, run_delivery_settled_revision,
       json_extract(CAST(data AS TEXT), '$.run.executionId') AS execution_id,
       json_extract(CAST(data AS TEXT), '$.run.recoverability') AS recoverability,
       json_extract(CAST(data AS TEXT), '$.run.lastCheckpointId') AS checkpoint_id,
       json_extract(CAST(data AS TEXT), '$.run.failure.code') AS failure_code,
       updated_at_ms
FROM conversation_records
WHERE conversation_id = :conversation_id AND kind = 'run'
ORDER BY sequence DESC LIMIT 50;
```

Runtime statuses are `starting`, `running`, `retrying`, `waiting`, `executing_tools`, `suspended`, `cancellation_requested`, `cancellation_failed`, `interrupted`, `completed`, `failed`, `cancelled`. Terminal runtime statuses are `completed`, `failed`, `cancelled`.

For approval checkpoints, non-final sibling decisions can leave the run `waiting`. Recording all decisions releases approved durable tool work (`executing_tools`); terminal tool settlement then permits `suspended` and continuation. Merely resolving all approvals does not imply immediate suspension. Confirm the specific checkpoint and later events; do not apply this sequence indiscriminately to every interaction kind.

## Inspect authority, work, and recovery

Check schema availability first: these tables were introduced by lifecycle migrations. Lifecycle run state is `open`, `completed`, `cancelled`, or `failed`, distinct from runtime status. Do not compare revisions across independent aggregates as if they share a counter. Inspect JSON keys before assuming a lifecycle payload has the transcript run envelope.

```sql
SELECT run_id, lifecycle_state, branch_epoch, revision, payload_version,
       updated_at_ms
FROM run_lifecycle_records
WHERE conversation_id = :conversation_id
ORDER BY updated_at_ms DESC
LIMIT 50;

SELECT id AS work_id, run_id, proposal_id, kind, state, generation,
       attempt_count, not_before_ms, lease_owner, lease_deadline_ms,
       CASE WHEN state = 'leased' AND lease_deadline_ms <= :observed_at_ms
            THEN 1 ELSE 0 END AS lease_expired_at_observation,
       CASE WHEN state = 'ready' AND not_before_ms <= :observed_at_ms
            THEN 1 ELSE 0 END AS due_at_observation,
       updated_at_ms
FROM lifecycle_work
WHERE conversation_id = :conversation_id
  AND state IN ('ready', 'leased', 'failed', 'outcome_unknown')
ORDER BY updated_at_ms DESC
LIMIT 50;

SELECT issue_id, run_id, work_id, code, resolved, created_at_ms, updated_at_ms
FROM lifecycle_recovery_issues
WHERE conversation_id = :conversation_id AND resolved = 0
ORDER BY updated_at_ms DESC
LIMIT 50;

SELECT a.attempt_id, a.proposal_id, p.invocation_id, a.run_id,
       a.state, a.generation, a.result_entry_id, a.updated_at_ms
FROM lifecycle_execution_attempts a
JOIN lifecycle_tool_proposals p ON p.proposal_id = a.proposal_id
WHERE p.conversation_id = :conversation_id
ORDER BY a.updated_at_ms DESC
LIMIT 50;

SELECT interaction_id, proposal_id, run_id, state, resolution_request_id,
       updated_at_ms
FROM lifecycle_interactions
WHERE conversation_id = :conversation_id
ORDER BY updated_at_ms DESC
LIMIT 50;

SELECT id, request_id, status, created_at_ms, updated_at_ms
FROM reconciliation_operations
WHERE conversation_id = :conversation_id
ORDER BY updated_at_ms DESC
LIMIT 50;
```

A due item or expired lease is a lead, not proof of a dead worker. Correlate with the snapshot time, worker logs, recovery issues, and later generations. `outcome_unknown` means external effects may have happened: do not manually requeue or rerun. If continuation is missing, also inspect succeeded/cancelled work by removing the state filter within the same bounded conversation window.

## Follow the result into continuation

For an attempt with `result_entry_id`, locate that record and later records in the same conversation. Remove the work-state filter above to include succeeded/cancelled work. Correlate proposal/invocation IDs, generation and result entry; proposal IDs are not necessarily tool-call IDs. Compare `run_delivery_settled_revision` only according to the owning run delivery implementation, not independent lifecycle aggregate revisions.

Use [event ordering](storage-ui-mismatches.md#inspect-durable-event-order) and redacted worker/startup logs to distinguish transient queue state from stalled work. A due item or expired lease alone is not proof a worker is dead.

## Stop or escalate

Report the last confirmed transition, due/lease times at observation, attempts/results, unresolved issue codes and missing continuation evidence. `outcome_unknown` means external effects may have happened: never manually requeue or rerun. If the snapshot predates a reported completion, take a new separately timestamped snapshot rather than mixing evidence silently.

Sources: `packages/contracts/src/domains/runs/run-runtime.ts`; `packages/workbench-server/src/domains/runs/runtime/run-interaction-coordinator.ts`; `packages/workbench-server/src/infrastructure/persistence/canonical-sqlite/lifecycle-work-database.ts`.
