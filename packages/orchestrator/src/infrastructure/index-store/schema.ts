export const INDEX_STORE_SCHEMA_SQL = `
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
  CREATE TABLE IF NOT EXISTS events_index (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    project_id TEXT,
    conversation_id TEXT,
    agent_id TEXT,
    run_id TEXT,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processes (
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
  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_questions (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_index_type_ts ON events_index(type, ts);
  CREATE INDEX IF NOT EXISTS events_index_conversation_seq ON events_index(conversation_id, seq);
  CREATE INDEX IF NOT EXISTS events_index_agent_seq ON events_index(agent_id, seq);
`;
