export const INDEX_STORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dir TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    permission_level TEXT NOT NULL,
    active_agent_id TEXT,
    active_entry_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_agent_id TEXT,
    root_agent_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    permission_level TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT,
    project_id TEXT,
    conversation_id TEXT,
    agent_id TEXT,
    cwd TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    pending_interaction_kind TEXT,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    preview_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tool_calls_conversation ON tool_calls(conversation_id);
  CREATE INDEX IF NOT EXISTS tool_calls_project ON tool_calls(project_id);
  CREATE INDEX IF NOT EXISTS tool_calls_run ON tool_calls(run_id);
  CREATE INDEX IF NOT EXISTS tool_calls_status ON tool_calls(status);
  CREATE INDEX IF NOT EXISTS tool_calls_updated ON tool_calls(updated_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS tool_calls_project ON tool_calls(project_id);
  CREATE INDEX IF NOT EXISTS tool_calls_run ON tool_calls(run_id);
  CREATE INDEX IF NOT EXISTS tool_calls_status ON tool_calls(status);
  CREATE INDEX IF NOT EXISTS tool_calls_pending_interaction ON tool_calls(pending_interaction_kind);
  CREATE TABLE IF NOT EXISTS tool_call_hydration (
    id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prompt_suggestion_trust (
    trust_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    predicate_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS prompt_suggestion_trust_path ON prompt_suggestion_trust(path);
`;
