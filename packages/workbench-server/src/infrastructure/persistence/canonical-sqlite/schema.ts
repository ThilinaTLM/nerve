import { UNIFIED_TIMELINE_V5_SQL } from "./unified-timeline-schema.js";
import { TIMELINE_DELETION_WORK_V6_SQL } from "./timeline-deletion-schema.js";
import { TIMELINE_SEARCH_PROJECTION_V7_SQL } from "./timeline-search-schema.js";
import { TIMELINE_RESTORE_V8_SQL } from "./timeline-restore-schema.js";
import { TIMELINE_AUTHORITY_PROMOTION_V9_SQL } from "./timeline-authority-promotion-schema.js";
import { TIMELINE_LIFECYCLE_WORK_V10_SQL } from "./timeline-lifecycle-work-schema.js";

export const CANONICAL_SCHEMA_VERSION = 10;
export const CANONICAL_BASELINE_VERSION = 1;
export const CANONICAL_BASELINE_NAME = "nerve-home-v1";
export const CANONICAL_BASELINE_CHECKSUM =
  "f9dc1e603a8e1adbd9254471ae6e096ca92399edc0d2117933ad62850de2ad39";
/** Checksum of the immutable v1 baseline SQL. */
export const CANONICAL_SCHEMA_CHECKSUM = CANONICAL_BASELINE_CHECKSUM;
export const CANONICAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  applied_at_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS conversation_records (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT,
  parent_id TEXT,
  run_id TEXT,
  group_id TEXT,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  kind TEXT NOT NULL CHECK(kind IN ('message','summary','run','tool_call','tool_batch')),
  status TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  run_delivery_settled_revision INTEGER
    CHECK(run_delivery_settled_revision >= 0),
  UNIQUE(conversation_id, sequence),
  FOREIGN KEY(parent_id) REFERENCES conversation_records(id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX IF NOT EXISTS conversation_records_sequence
  ON conversation_records(conversation_id, sequence);
CREATE INDEX IF NOT EXISTS conversation_records_agent_kind_status
  ON conversation_records(conversation_id, agent_id, kind, status);
CREATE INDEX IF NOT EXISTS conversation_records_parent
  ON conversation_records(parent_id);
CREATE INDEX IF NOT EXISTS conversation_records_run_group
  ON conversation_records(run_id, group_id, kind, status);
CREATE INDEX IF NOT EXISTS conversation_records_kind_status_id
  ON conversation_records(kind, status, id);
CREATE INDEX IF NOT EXISTS conversation_records_pending_run_delivery
  ON conversation_records(run_delivery_settled_revision, revision, id)
  WHERE kind = 'run';

CREATE TABLE IF NOT EXISTS conversation_record_projections (
  record_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  kind TEXT NOT NULL CHECK(kind IN ('message','summary','run')),
  status TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(record_id) REFERENCES conversation_records(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS conversation_record_projections_sequence
  ON conversation_record_projections(conversation_id, sequence);
CREATE INDEX IF NOT EXISTS conversation_record_projections_kind_status
  ON conversation_record_projections(kind, status, record_id);

CREATE TABLE IF NOT EXISTS tool_call_projections (
  record_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  pending_interaction_kind TEXT,
  tool_name TEXT NOT NULL,
  has_interaction INTEGER NOT NULL CHECK(has_interaction IN (0, 1)),
  has_plan_review INTEGER NOT NULL CHECK(has_plan_review IN (0, 1)),
  is_todo_state INTEGER NOT NULL CHECK(is_todo_state IN (0, 1)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(record_id) REFERENCES conversation_records(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS tool_call_projections_conversation
  ON tool_call_projections(conversation_id);
CREATE INDEX IF NOT EXISTS tool_call_projections_project
  ON tool_call_projections(project_id);
CREATE INDEX IF NOT EXISTS tool_call_projections_agent
  ON tool_call_projections(agent_id);
CREATE INDEX IF NOT EXISTS tool_call_projections_run
  ON tool_call_projections(run_id);
CREATE INDEX IF NOT EXISTS tool_call_projections_status
  ON tool_call_projections(status);
CREATE INDEX IF NOT EXISTS tool_call_projections_updated
  ON tool_call_projections(updated_at DESC, record_id DESC);
CREATE INDEX IF NOT EXISTS tool_call_projections_pending_interaction
  ON tool_call_projections(pending_interaction_kind);
CREATE INDEX IF NOT EXISTS tool_call_projections_startup
  ON tool_call_projections(status, is_todo_state, has_interaction);

CREATE TABLE IF NOT EXISTS agent_context_leaves (
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  active_record_id TEXT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY(conversation_id, agent_id),
  FOREIGN KEY(active_record_id) REFERENCES conversation_records(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE IF NOT EXISTS durable_event_stream_counters (
  stream TEXT PRIMARY KEY,
  next_sequence INTEGER NOT NULL CHECK(next_sequence > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS durable_events (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream TEXT NOT NULL,
  stream_sequence INTEGER NOT NULL CHECK(stream_sequence > 0),
  conversation_id TEXT,
  record_id TEXT,
  record_revision INTEGER,
  intent_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  UNIQUE(stream, stream_sequence),
  FOREIGN KEY(record_id) REFERENCES conversation_records(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS durable_events_stream_sequence
  ON durable_events(stream, stream_sequence);
CREATE INDEX IF NOT EXISTS durable_events_conversation_sequence
  ON durable_events(conversation_id, stream_sequence);

CREATE TABLE IF NOT EXISTS file_assets (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('payload','report','image','plan','task_log')),
  logical_path TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  tool_call_id TEXT,
  task_id TEXT,
  digest TEXT CHECK(digest IS NULL OR length(digest) = 64),
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  media_type TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS file_assets_owner
  ON file_assets(conversation_id, tool_call_id, task_id, category);

CREATE TABLE IF NOT EXISTS rpc_idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  outcome BLOB NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(scope, key)
) STRICT;
CREATE INDEX IF NOT EXISTS rpc_idempotency_expiry
  ON rpc_idempotency(expires_at_ms, created_at_ms);

CREATE TABLE IF NOT EXISTS domain_documents (
  namespace TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(namespace, scope_id, document_id)
) STRICT;
CREATE INDEX IF NOT EXISTS domain_documents_scope
  ON domain_documents(namespace, scope_id, updated_at_ms);
`;

const LIFECYCLE_WORK_V2_SQL = `CREATE TABLE lifecycle_work (
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

const LIFECYCLE_AUTHORITY_V3_SQL = `CREATE TABLE run_lifecycle_records (
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

const LIFECYCLE_RUN_CONVERSION_V4_SQL = `INSERT INTO run_lifecycle_records (
  run_id, conversation_id, lifecycle_state, branch_epoch, revision,
  payload_version, data, updated_at_ms
)
SELECT id, conversation_id,
  CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'open'
  END,
  1, revision, payload_version, data, updated_at_ms
FROM conversation_records
WHERE kind = 'run'
ON CONFLICT(run_id) DO NOTHING;`;

export interface CanonicalMigration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export const CANONICAL_MIGRATIONS: readonly CanonicalMigration[] = [
  {
    version: 2,
    name: "atomic-run-lifecycle-work-v2",
    checksum:
      "cad065565ceacee71bbc5a34193d75cc32eabf02f5d2781ba23931c41a216156",
    sql: LIFECYCLE_WORK_V2_SQL,
  },
  {
    version: 3,
    name: "authoritative-run-lifecycle-v3",
    checksum:
      "903cc4597ae995ce01312150eb0168e8b4e2313f833b160fd2015bea273d1fe5",
    sql: LIFECYCLE_AUTHORITY_V3_SQL,
  },
  {
    version: 4,
    name: "convert-run-lifecycle-v4",
    checksum:
      "496cd5027ff354aee6aed213f19bb6c6771d5c847cc799d85e1cc4fd5781b28a",
    sql: LIFECYCLE_RUN_CONVERSION_V4_SQL,
  },
  {
    version: 5,
    name: "unified-conversation-timeline-v5",
    checksum:
      "aeb2ff5e6642e41e039d5c729215ecec889feee37ac80f206a03dcac87b9a8a1",
    sql: UNIFIED_TIMELINE_V5_SQL,
  },
  {
    version: 6,
    name: "timeline-deletion-work-v6",
    checksum:
      "66874fa2f977a0e18963f9557fc588d06d1136b49b7a725b81c55c55b6724ac9",
    sql: TIMELINE_DELETION_WORK_V6_SQL,
  },
  {
    version: 7,
    name: "timeline-search-projection-v7",
    checksum:
      "561fb0f1b3020fff645779ad8eeeae419e09d877f4efc4345747ebac1ca66ba1",
    sql: TIMELINE_SEARCH_PROJECTION_V7_SQL,
  },
  {
    version: 8,
    name: "timeline-restore-quarantine-v8",
    checksum:
      "924aa2bdac347f2c9b4a47037905c5b8e5962f24e4d49fea29d2d6df73c4a5b2",
    sql: TIMELINE_RESTORE_V8_SQL,
  },
  {
    version: 9,
    name: "timeline-authority-promotion-v9",
    checksum:
      "552b03feb9d508e98fb64de98be2bc996b5c3abc3e8b2d1f21c12cfbbac434a3",
    sql: TIMELINE_AUTHORITY_PROMOTION_V9_SQL,
  },
  {
    version: 10,
    name: "timeline-lifecycle-work-v10",
    checksum:
      "4c9eb6e74245ba0300b21e0f7a07264fb95162f0f448c58322ca35f9ad3021cc",
    sql: TIMELINE_LIFECYCLE_WORK_V10_SQL,
  },
];
