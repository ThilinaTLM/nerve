import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `CREATE TABLE run_lifecycle_records (
  run_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('open','completed','cancelled','failed')),
  branch_epoch INTEGER NOT NULL CHECK(branch_epoch > 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX run_lifecycle_candidates
  ON run_lifecycle_records(lifecycle_state, updated_at_ms, run_id);
CREATE INDEX run_lifecycle_conversation
  ON run_lifecycle_records(conversation_id, lifecycle_state, run_id);

CREATE TABLE lifecycle_tool_proposals (
  proposal_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL UNIQUE,
  arguments_hash TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES run_lifecycle_records(run_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX lifecycle_proposals_run
  ON lifecycle_tool_proposals(run_id, proposal_id);

CREATE TABLE lifecycle_interactions (
  interaction_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','resolved','cancelled')),
  resolution_request_id TEXT,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES lifecycle_tool_proposals(proposal_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES run_lifecycle_records(run_id) ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX lifecycle_interaction_resolution_request
  ON lifecycle_interactions(interaction_id, resolution_request_id)
  WHERE resolution_request_id IS NOT NULL;
CREATE INDEX lifecycle_interactions_pending
  ON lifecycle_interactions(conversation_id, run_id, state, interaction_id);

CREATE TABLE lifecycle_execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ready','running','completed','failed','cancelled','outcome_unknown')),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  result_entry_id TEXT,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES lifecycle_tool_proposals(proposal_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES run_lifecycle_records(run_id) ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX lifecycle_attempt_active
  ON lifecycle_execution_attempts(proposal_id)
  WHERE state IN ('ready','running');
CREATE UNIQUE INDEX lifecycle_attempt_result_entry
  ON lifecycle_execution_attempts(result_entry_id)
  WHERE result_entry_id IS NOT NULL;

CREATE TABLE lifecycle_recovery_issues (
  issue_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  work_id TEXT,
  code TEXT NOT NULL,
  resolved INTEGER NOT NULL CHECK(resolved IN (0,1)),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES run_lifecycle_records(run_id) ON DELETE CASCADE,
  FOREIGN KEY(work_id) REFERENCES lifecycle_work(id) ON DELETE SET NULL
) STRICT;
CREATE INDEX lifecycle_recovery_open
  ON lifecycle_recovery_issues(conversation_id, resolved, issue_id);`;

export default defineSchemaStep({
  id: "0003-authoritative-run-lifecycle",
  description: "Add authoritative run lifecycle tables.",
  run({ db }) {
    db.exec(SQL);
  },
});
