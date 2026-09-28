import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `CREATE TABLE lifecycle_work (
  id TEXT PRIMARY KEY,
  deduplication_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  proposal_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('execute_tool','continue_model','reconcile_conversation')),
  state TEXT NOT NULL CHECK(state IN ('ready','leased','succeeded','failed','cancelled','outcome_unknown')),
  input_hash TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
  not_before_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_deadline_ms INTEGER,
  external_locator TEXT,
  last_error TEXT,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK((state = 'leased' AND lease_owner IS NOT NULL AND lease_deadline_ms IS NOT NULL) OR state <> 'leased')
) STRICT;
CREATE UNIQUE INDEX lifecycle_work_active_dedup
  ON lifecycle_work(deduplication_key)
  WHERE state IN ('ready','leased');
CREATE INDEX lifecycle_work_due
  ON lifecycle_work(state, not_before_ms, id);
CREATE INDEX lifecycle_work_leases
  ON lifecycle_work(state, lease_deadline_ms, id);
CREATE INDEX lifecycle_work_conversation
  ON lifecycle_work(conversation_id, state, id);
CREATE INDEX lifecycle_work_run
  ON lifecycle_work(run_id, state, id);

CREATE TABLE lifecycle_command_receipts (
  scope_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(scope_id, request_id)
) STRICT;

CREATE TABLE reconciliation_operations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(conversation_id, request_id)
) STRICT;
CREATE INDEX reconciliation_operations_status
  ON reconciliation_operations(status, updated_at_ms, id);`;

export default defineSchemaStep({
  id: "0002-atomic-run-lifecycle-work",
  description: "Add durable lifecycle work and command receipt tables.",
  run({ db }) {
    db.exec(SQL);
  },
});
