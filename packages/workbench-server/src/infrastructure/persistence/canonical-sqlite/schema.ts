export const CANONICAL_SCHEMA_VERSION = 3;
export const CANONICAL_BASELINE_NAME = "nerve-home-v3";
export const CANONICAL_SCHEMA_V1_CHECKSUM =
  "c6bfbb3901f4a51992de7baf11d11fa797ecc8063fa883d1fb6fb7d2e07d8433";
export const CANONICAL_SCHEMA_V2_CHECKSUM =
  "368532728f350a7ac8d76ef5a91b7b76f902024c2096be65e37eef121e4402b0";
export const CANONICAL_SCHEMA_CHECKSUM =
  "6aeb3d94e691e7ec2f5ab86ca030dac33fc2dc5db8eceb99b461ef55c3f658e9";
export const CANONICAL_V1_TO_V2_MIGRATION_NAME =
  "drop-redundant-canonical-tables";
export const CANONICAL_V1_TO_V2_MIGRATION_SQL = `
DROP INDEX IF EXISTS permission_rules_scope_tool;
DROP TABLE IF EXISTS permission_rules;
DROP TABLE IF EXISTS canonical_meta;
`;
export const CANONICAL_V2_TO_V3_MIGRATION_NAME =
  "add-bounded-conversation-projections";
export const CANONICAL_V2_TO_V3_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS conversation_records_kind_status_id
  ON conversation_records(kind, status, id);
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
`;
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
