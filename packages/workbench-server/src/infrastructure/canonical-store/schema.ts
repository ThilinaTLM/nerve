export const CANONICAL_V2_SCHEMA_VERSION = 2;
export const CANONICAL_V2_SCHEMA_CHECKSUM =
  "531dd8310f8326ba9f21a5b2e3cfae67dfce5b620d3aca28e415ac882b30c3ad";
export const CANONICAL_SCHEMA_VERSION = 3;
export const CANONICAL_BASELINE_NAME = "canonical-storage-baseline";
export const CANONICAL_SCHEMA_CHECKSUM =
  "0c37fcedf26320bcbc4b7b966a39ccbaa9759fd8295fc3cdc8c850d0c8598367";
export const CANONICAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  applied_at_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS canonical_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS settings_store (
  id TEXT PRIMARY KEY CHECK(id = 'settings'),
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS permission_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('user','project')),
  project_id TEXT,
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  tool_name TEXT NOT NULL,
  matcher_kind TEXT NOT NULL CHECK(matcher_kind IN ('whole_tool','path_glob','command_glob','url_glob')),
  pattern TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK((scope = 'project' AND project_id IS NOT NULL) OR (scope = 'user' AND project_id IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS permission_rules_scope_tool
  ON permission_rules(scope, project_id, tool_name, enabled);

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
