export const CANONICAL_SCHEMA_VERSION = 5;
export const CANONICAL_BASELINE_NAME = "nerve-home-v5";
export const CANONICAL_SCHEMA_V1_CHECKSUM =
  "c6bfbb3901f4a51992de7baf11d11fa797ecc8063fa883d1fb6fb7d2e07d8433";
export const CANONICAL_SCHEMA_V2_CHECKSUM =
  "368532728f350a7ac8d76ef5a91b7b76f902024c2096be65e37eef121e4402b0";
export const CANONICAL_SCHEMA_V3_CHECKSUM =
  "6aeb3d94e691e7ec2f5ab86ca030dac33fc2dc5db8eceb99b461ef55c3f658e9";
export const CANONICAL_SCHEMA_V4_CHECKSUM =
  "215ebadf1b693567375dddb6d38ca80ee968ed4fd8fb8ce4f97f793ec55d4854";
export const CANONICAL_SCHEMA_CHECKSUM =
  "215ebadf1b693567375dddb6d38ca80ee968ed4fd8fb8ce4f97f793ec55d4854";
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
export const CANONICAL_V3_TO_V4_MIGRATION_NAME = "index-startup-recovery-state";
export const CANONICAL_V3_TO_V4_MIGRATION_SQL = `
ALTER TABLE conversation_records
  ADD COLUMN run_delivery_settled_revision INTEGER
  CHECK(run_delivery_settled_revision >= 0);
UPDATE conversation_records
SET run_delivery_settled_revision = CASE
  WHEN json_valid(CAST(data AS TEXT))
    AND json_extract(CAST(data AS TEXT), '$.state.deliveries[#-1].intentId') =
      '__nerve_settled__:' || id || ':' || json_extract(
        CAST(data AS TEXT), '$.state.deliveries[#-1].revision'
      )
    AND typeof(json_extract(
      CAST(data AS TEXT), '$.state.deliveries[#-1].revision'
    )) = 'integer'
    AND json_extract(
      CAST(data AS TEXT), '$.state.deliveries[#-1].revision'
    ) BETWEEN 0 AND revision
  THEN json_extract(CAST(data AS TEXT), '$.state.deliveries[#-1].revision')
  ELSE NULL
END
WHERE kind = 'run';
CREATE INDEX conversation_records_pending_run_delivery
  ON conversation_records(run_delivery_settled_revision, revision, id)
  WHERE kind = 'run';
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
INSERT OR REPLACE INTO tool_call_projections (
  record_id, conversation_id, project_id, agent_id, run_id, status,
  pending_interaction_kind, tool_name, has_interaction, has_plan_review,
  is_todo_state, revision, updated_at
)
SELECT
  id,
  conversation_id,
  json_extract(CAST(data AS TEXT), '$.toolCall.projectId'),
  json_extract(CAST(data AS TEXT), '$.toolCall.agentId'),
  json_extract(CAST(data AS TEXT), '$.toolCall.runId'),
  json_extract(CAST(data AS TEXT), '$.toolCall.status'),
  (
    SELECT json_extract(interaction.value, '$.kind')
    FROM json_each(CAST(record.data AS TEXT), '$.toolCall.interactions') interaction
    WHERE json_extract(interaction.value, '$.status') = 'pending'
    LIMIT 1
  ),
  json_extract(CAST(data AS TEXT), '$.toolCall.toolName'),
  json_array_length(
    json_extract(CAST(data AS TEXT), '$.toolCall.interactions')
  ) > 0,
  EXISTS (
    SELECT 1
    FROM json_each(CAST(record.data AS TEXT), '$.toolCall.interactions') interaction
    WHERE json_extract(interaction.value, '$.kind') = 'plan_review'
  ),
  CASE WHEN
    json_extract(CAST(data AS TEXT), '$.toolCall.toolName') = 'todos_set'
    AND json_extract(CAST(data AS TEXT), '$.toolCall.status') = 'completed'
  THEN 1 ELSE 0 END,
  revision,
  json_extract(CAST(data AS TEXT), '$.toolCall.updatedAt')
FROM conversation_records record
WHERE kind = 'tool_call' AND json_valid(CAST(data AS TEXT));
`;
export const CANONICAL_V4_TO_V5_MIGRATION_NAME = "compact-managed-file-paths";
export const CANONICAL_V4_TO_V5_MIGRATION_SQL = `
UPDATE conversation_records
SET data = CAST(json_set(
  CAST(data AS TEXT),
  '$.toolCall.resultPayload.version',
  2,
  '$.toolCall.resultPayload.logicalPath',
  'conversations/' || substr(conversation_id, 6) ||
    '/tool-calls/' || substr(id, 6) || '/result.json'
) AS BLOB)
WHERE kind = 'tool_call'
  AND json_valid(CAST(data AS TEXT))
  AND json_extract(CAST(data AS TEXT), '$.toolCall.resultPayload.kind') =
    'tool_result';
UPDATE file_assets
SET logical_path =
  'conversations/' || substr(conversation_id, 6) ||
  '/tool-calls/' || substr(tool_call_id, 6) || '/result.json'
WHERE category = 'payload'
  AND conversation_id LIKE 'conv_%'
  AND tool_call_id LIKE 'tool_%';
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
