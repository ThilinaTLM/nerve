import { defineSchemaStep } from "../../kit/define-step/v1.js";

// Frozen canonical v8 SQL. SQLite parses authority during index construction;
// malformed authoritative JSON fails the transaction rather than being skipped.
const SQL = `CREATE INDEX conversation_records_initial_input_lookup
ON conversation_records (
  agent_id,
  json_extract(CAST(data AS TEXT), '$.run.initialInputId'),
  sequence,
  id
)
WHERE kind = 'run';`;

export default defineSchemaStep({
  id: "0012-run-initial-input-lookup",
  description:
    "Index the first canonical admission for an agent's originating input without hydrating run histories.",
  run({ db }) {
    db.exec(SQL);
  },
  verify({ db }) {
    const index = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'conversation_records_initial_input_lookup'",
      )
      .get() as { sql: string } | undefined;
    if (index?.sql !== SQL.slice(0, -1))
      throw new Error(
        "Canonical initial-input index definition does not match v8",
      );
  },
});
