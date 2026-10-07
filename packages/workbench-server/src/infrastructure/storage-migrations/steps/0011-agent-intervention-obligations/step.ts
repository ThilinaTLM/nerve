import { defineSchemaStep } from "../../kit/define-step/v1.js";

// Rebuild only the constraint. IDs, payloads, timestamps, unique correlations
// and original report-generation fences are copied without interpretation.
const SQL = `ALTER TABLE agent_async_obligations RENAME TO agent_async_obligations_v7;
DROP INDEX agent_async_obligations_owner_state;
DROP INDEX agent_async_obligations_conversation_state;
DROP INDEX agent_async_obligations_notification_entry;
CREATE TABLE agent_async_obligations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('promoted_task','async_subagent','user_intervention')),
  source_id TEXT NOT NULL,
  source_agent_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','delivered','consumed','cancelled','suppressed')),
  notification_entry_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(source_kind, source_id, generation)
) STRICT;
CREATE INDEX agent_async_obligations_owner_state
  ON agent_async_obligations(owner_agent_id, state);
CREATE INDEX agent_async_obligations_conversation_state
  ON agent_async_obligations(conversation_id, state);
CREATE INDEX agent_async_obligations_notification_entry
  ON agent_async_obligations(notification_entry_id);
INSERT INTO agent_async_obligations SELECT * FROM agent_async_obligations_v7;
DROP TABLE agent_async_obligations_v7;`;

export default defineSchemaStep({
  id: "0011-agent-intervention-obligations",
  description:
    "Allow durable correlated user intervention notices in the existing obligation table.",
  run({ db }) {
    db.exec(SQL);
  },
  verify({ db }) {
    const table = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_async_obligations'",
      )
      .get() as { sql: string } | undefined;
    if (!table?.sql.includes("'user_intervention'"))
      throw new Error("Intervention obligation source constraint is missing");
  },
});
