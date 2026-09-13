import type { DatabaseSync } from "node:sqlite";
import { withTimelineImmediateTransaction } from "../../persistence/canonical-sqlite/timeline-transaction.js";

export interface LegacyLifecycleAuthorityFact {
  sourceTable: string;
  sourceId: string;
  conversationId: string;
  runId?: string;
  state: string;
  kind: string;
  fingerprint?: string;
}

/** Reads bounded identifying facts only; opaque payloads stay archived in backup. */
export function readLegacyLifecycleAuthorityFacts(
  database: DatabaseSync,
): LegacyLifecycleAuthorityFact[] {
  const rows = database
    .prepare(
      `SELECT 'lifecycle_work' source_table, id source_id, conversation_id,
              run_id, state, kind, input_hash fingerprint FROM lifecycle_work
       UNION ALL
       SELECT 'run_lifecycle_records', run_id, conversation_id, run_id,
              lifecycle_state, 'run', NULL FROM run_lifecycle_records
       UNION ALL
       SELECT 'lifecycle_tool_proposals', proposal_id, conversation_id, run_id,
              'proposed', 'tool_proposal', arguments_hash
         FROM lifecycle_tool_proposals
       UNION ALL
       SELECT 'lifecycle_interactions', interaction_id, conversation_id, run_id,
              state, 'interaction', NULL FROM lifecycle_interactions
       UNION ALL
       SELECT 'lifecycle_execution_attempts', attempts.attempt_id,
              runs.conversation_id, attempts.run_id, attempts.state,
              'execution_attempt', NULL
         FROM lifecycle_execution_attempts attempts
         JOIN run_lifecycle_records runs ON runs.run_id = attempts.run_id
       UNION ALL
       SELECT 'lifecycle_recovery_issues', issue_id, conversation_id, run_id,
              CASE resolved WHEN 1 THEN 'resolved' ELSE 'open' END,
              code, NULL FROM lifecycle_recovery_issues
       UNION ALL
       SELECT 'reconciliation_operations', id, conversation_id, NULL,
              status, 'reconciliation', request_id
         FROM reconciliation_operations
       ORDER BY source_table, source_id`,
    )
    .all() as unknown as Array<{
    source_table: string;
    source_id: string;
    conversation_id: string;
    run_id: string | null;
    state: string;
    kind: string;
    fingerprint: string | null;
  }>;
  return rows.map((row) => ({
    sourceTable: row.source_table,
    sourceId: row.source_id,
    conversationId: row.conversation_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    state: row.state,
    kind: row.kind,
    ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
  }));
}

export function countLegacyRuntimeAuthority(database: DatabaseSync): number {
  const row = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM conversation_records) +
         (SELECT COUNT(*) FROM lifecycle_work) +
         (SELECT COUNT(*) FROM run_lifecycle_records) +
         (SELECT COUNT(*) FROM reconciliation_operations) AS count`,
    )
    .get() as { count: number };
  return row.count;
}

/** Irreversible offline retirement after canonical evidence has committed. */
export function retireLegacyRuntimeAuthority(database: DatabaseSync): number {
  return withTimelineImmediateTransaction(database, () => {
    const admission = database
      .prepare(
        `SELECT dispatch_state FROM runtime_admission WHERE singleton = 1`,
      )
      .get() as { dispatch_state: string } | undefined;
    if (admission?.dispatch_state !== "disabled") {
      throw new Error(
        "Legacy authority retirement requires disabled dispatch.",
      );
    }
    const count = countLegacyRuntimeAuthority(database);
    database.exec(`
      DELETE FROM lifecycle_recovery_issues;
      DELETE FROM lifecycle_execution_attempts;
      DELETE FROM lifecycle_interactions;
      DELETE FROM lifecycle_tool_proposals;
      DELETE FROM run_lifecycle_records;
      DELETE FROM lifecycle_work;
      DELETE FROM lifecycle_command_receipts;
      DELETE FROM reconciliation_operations;
      DELETE FROM durable_events;
      DELETE FROM durable_event_stream_counters;
      DELETE FROM rpc_idempotency;
      DELETE FROM agent_context_leaves;
    `);
    let removed = 1;
    while (removed > 0) {
      const result = database
        .prepare(
          `DELETE FROM conversation_records
           WHERE id IN (
             SELECT parent.id FROM conversation_records parent
             WHERE NOT EXISTS (
               SELECT 1 FROM conversation_records child
               WHERE child.parent_id = parent.id
             )
             LIMIT 500
           )`,
        )
        .run();
      removed = Number(result.changes);
    }
    const remaining = database
      .prepare(`SELECT COUNT(*) count FROM conversation_records`)
      .get() as { count: number };
    if (remaining.count !== 0) {
      throw new Error(
        "Legacy conversation records contain an unretired cycle.",
      );
    }
    return count;
  });
}
