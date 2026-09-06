import type { DatabaseSync } from "node:sqlite";

/** Additive access paths: deliberately outside the immutable v1 baseline. */
export const CANONICAL_DELETION_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS durable_events_record ON durable_events(record_id);
CREATE INDEX IF NOT EXISTS agent_context_leaves_active_record ON agent_context_leaves(active_record_id);
`;

/** Called inside the startup writer transaction, before accepting requests. */
export function repairCanonicalDeletionIndexes(database: DatabaseSync): void {
  database.exec(CANONICAL_DELETION_INDEX_SQL);
  for (const [name, table, column] of [
    ["durable_events_record", "durable_events", "record_id"],
    [
      "agent_context_leaves_active_record",
      "agent_context_leaves",
      "active_record_id",
    ],
  ] as const) {
    const indexes = database.prepare(`PRAGMA index_list('${table}')`).all();
    const index = indexes.find((row) => row.name === name);
    const columns = database.prepare(`PRAGMA index_info('${name}')`).all();
    if (
      !index ||
      index.unique !== 0 ||
      index.partial !== 0 ||
      columns.length !== 1 ||
      columns[0]?.name !== column
    ) {
      throw new Error(
        `Canonical deletion index ${name} must index ${table}(${column}) without a predicate or uniqueness constraint.`,
      );
    }
  }
}
