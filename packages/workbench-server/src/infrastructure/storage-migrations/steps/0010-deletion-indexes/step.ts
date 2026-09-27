import {
  defineSchemaStep,
  type MigrationContextV1,
} from "../../kit/define-step/v1.js";

const indexes = [
  ["durable_events_record", "durable_events", "record_id"],
  [
    "agent_context_leaves_active_record",
    "agent_context_leaves",
    "active_record_id",
  ],
] as const;

function verify(db: MigrationContextV1["db"]): void {
  for (const [name, table, column] of indexes) {
    const listed = db.prepare(`PRAGMA index_list('${table}')`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>;
    const index = listed.find((candidate) => candidate.name === name);
    const columns = db.prepare(`PRAGMA index_info('${name}')`).all() as Array<{
      name: string;
    }>;
    if (
      !index ||
      index.unique !== 0 ||
      index.partial !== 0 ||
      columns.length !== 1 ||
      columns[0]?.name !== column
    ) {
      throw new Error(
        `Deletion index ${name} must index ${table}(${column}) without a predicate or uniqueness constraint.`,
      );
    }
  }
}

export default defineSchemaStep({
  id: "0010-deletion-indexes",
  description:
    "Add the exact access paths required for cascading conversation deletion.",
  run({ db }) {
    db.exec(`CREATE INDEX IF NOT EXISTS durable_events_record ON durable_events(record_id);
CREATE INDEX IF NOT EXISTS agent_context_leaves_active_record ON agent_context_leaves(active_record_id);`);
  },
  verify({ db }) {
    verify(db);
  },
});
