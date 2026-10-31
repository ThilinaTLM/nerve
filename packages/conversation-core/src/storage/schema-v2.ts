import type { CoreDatabase } from "./database.js";

/** Approved D10 schema. Home step 0002 must verify every source-bound JSON export
 * including prompt context before rebuilding populated storage. No runtime opens may bypass that gate.
 * Released v1 is unchanged; the unreleased agent_profile column is never created.
 */
export const coreSchemaV2 = `
CREATE TABLE conversation_new (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_conversation_id TEXT, parent_tool_call_id TEXT, head_event_id TEXT, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('idle','running','waiting','failed','interrupted')),
  status_event_sequence INTEGER NOT NULL CHECK(status_event_sequence >= 0), status_cleared_at TEXT,
  paused INTEGER NOT NULL CHECK(paused IN (0,1)), next_input_sequence INTEGER NOT NULL CHECK(next_input_sequence > 0),
  pinned_at TEXT, completed_at TEXT, last_user_message_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, parent_conversation_id) REFERENCES conversation(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(id, head_event_id) REFERENCES conversation_event(conversation_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(parent_conversation_id IS NULL OR parent_conversation_id <> id)
) STRICT;
INSERT INTO conversation_new
  (id, project_id, parent_conversation_id, parent_tool_call_id, head_event_id, title, status, status_event_sequence, status_cleared_at, paused, next_input_sequence, pinned_at, completed_at, last_user_message_at, created_at, updated_at, working_directory)
SELECT c.id, c.project_id, c.parent_conversation_id, c.parent_tool_call_id, c.head_event_id, c.title, c.status, c.status_event_sequence, c.status_cleared_at, c.paused, c.next_input_sequence, c.pinned_at, c.completed_at, c.last_user_message_at, c.created_at, c.updated_at, cfg.working_directory
FROM conversation c JOIN conversation_config cfg ON cfg.conversation_id=c.id;
DROP TABLE conversation_config;
DROP TABLE conversation;
ALTER TABLE conversation_new RENAME TO conversation;
CREATE INDEX conversation_project_parent_updated ON conversation(project_id, parent_conversation_id, updated_at, id);
CREATE INDEX conversation_parent ON conversation(parent_conversation_id);
CREATE INDEX conversation_pinned ON conversation(project_id, pinned_at) WHERE pinned_at IS NOT NULL;
CREATE TABLE conversation_reference (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('referenced','created')),
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, provider, resource_key)
) STRICT;
CREATE TABLE trusted_resource_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('prompt_suggestion','skill','project_permissions','project_capabilities','agent_profile')),
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  path TEXT NOT NULL, name TEXT, content_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('trusted','rejected')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
INSERT INTO trusted_resource_new
SELECT id, CASE kind WHEN 'subagent_profile' THEN 'agent_profile' ELSE kind END,
  project_id, path, name, content_digest, status, created_at, updated_at FROM trusted_resource;
DROP TABLE trusted_resource;
ALTER TABLE trusted_resource_new RENAME TO trusted_resource;
CREATE UNIQUE INDEX trusted_resource_project_path ON trusted_resource(kind, project_id, path) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX trusted_resource_user_path ON trusted_resource(kind, path) WHERE project_id IS NULL;
`;

export function applyCoreSchemaV2(db: CoreDatabase): void {
  // Populated released storage is exclusively exported/dropped by home step 0002.
  // Standalone core initialization may rebuild only genuinely empty conversations/config tables.
  if (
    Number(
      db.sqlite.prepare("SELECT count(*) AS n FROM conversation_config").get()
        ?.n,
    ) !== 0 ||
    Number(
      db.sqlite.prepare("SELECT count(*) AS n FROM conversation").get()?.n,
    ) !== 0
  )
    throw new Error(
      "Home migration 0002 must verify agent exports before core SQL v2",
    );
  db.sqlite.exec(coreSchemaV2);
}
