import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `CREATE TABLE agent_async_obligations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('promoted_task','async_subagent')),
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
  ON agent_async_obligations(notification_entry_id);`;

export default defineSchemaStep({
  id: "0007-agent-async-obligations",
  description: "Add the unified asynchronous agent obligation table.",
  run({ db }) {
    db.exec(SQL);
  },
});
