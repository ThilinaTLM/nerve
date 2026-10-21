import type { CoreDatabase } from "./database.js";

// Rebuild under the original column name first so saved indexes/triggers/views
// can be restored verbatim. SQLite's RENAME COLUMN then updates their references.
const rebuild = `
CREATE TABLE conversation_config_new (
  conversation_id TEXT PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK(json_valid(model)),
  reasoning_level TEXT NOT NULL CHECK(reasoning_level IN ('off','minimal','low','medium','high','xhigh','max')),
  system_prompt TEXT, instructions TEXT, permission_rule_set_id TEXT NOT NULL, mode TEXT NOT NULL,
  working_directory TEXT NOT NULL
) STRICT;
INSERT INTO conversation_config_new SELECT * FROM conversation_config;
DROP TABLE conversation_config;
ALTER TABLE conversation_config_new RENAME TO conversation_config;
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
`;
const rename = `ALTER TABLE conversation_config RENAME COLUMN mode TO agent_profile;`;
export const coreSchemaV2 = rebuild + rename;

/** SQLite's generalized ALTER TABLE procedure. Caller disables FK enforcement
 * before BEGIN, checks foreign_key_check before COMMIT, then restores enforcement.
 */
export function applyCoreSchemaV2(db: CoreDatabase): void {
  const objects = db.sqlite
    .prepare(`SELECT type, name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (
      (type = 'index' AND tbl_name IN ('conversation_config','trusted_resource'))
      OR type IN ('view','trigger')
    ) ORDER BY CASE type WHEN 'view' THEN 0 ELSE 1 END, type, name`)
    .all();
  // Views referencing the old names must not make ALTER TABLE's schema validation
  // fail during the temporary absence of the rebuilt tables.
  for (const type of ["trigger", "view"])
    for (const object of objects)
      if (object.type === type)
        db.sqlite.exec(
          `DROP ${type.toUpperCase()} "${String(object.name).replaceAll('"', '""')}"`,
        );
  db.sqlite.exec(rebuild);
  for (const object of objects) db.sqlite.exec(String(object.sql));
  db.sqlite.exec(rename);
}
