import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `CREATE TABLE subagent_completions (
  run_id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  pending INTEGER NOT NULL CHECK(pending IN (0,1)),
  data BLOB NOT NULL
) STRICT;
CREATE INDEX subagent_completions_pending ON subagent_completions(lead_id, pending);
CREATE INDEX subagent_completions_conversation ON subagent_completions(conversation_id);`;

export default defineSchemaStep({
  id: "0005-async-subagent-completions",
  description: "Add durable asynchronous subagent completion storage.",
  run({ db }) {
    db.exec(SQL);
  },
});
