/**
 * Trust decisions v3 (docs/architecture/trust.md): `path` becomes `resource_key`, digests carry
 * their algorithm (`sha256:<hex>`), `grants` stores what the user approved beyond the digest,
 * and `kind` is validated in code (no SQL CHECK) so a new kind needs no table rebuild. Skills are
 * not trusted resources, so their rows are dropped.
 */
export const coreSchemaV4 = `
CREATE TABLE trusted_resource_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL, name TEXT,
  content_digest TEXT NOT NULL CHECK(content_digest LIKE 'sha256:%'),
  status TEXT NOT NULL CHECK(status IN ('trusted','rejected')),
  grants TEXT CHECK(grants IS NULL OR json_valid(grants)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
INSERT INTO trusted_resource_new
  (id, kind, project_id, resource_key, name, content_digest, status, grants, created_at, updated_at)
SELECT id, kind, project_id, path, name,
  CASE WHEN content_digest LIKE 'sha256:%' THEN content_digest ELSE 'sha256:' || content_digest END,
  status, NULL, created_at, updated_at
FROM trusted_resource WHERE kind <> 'skill';
DROP TABLE trusted_resource;
ALTER TABLE trusted_resource_new RENAME TO trusted_resource;
CREATE UNIQUE INDEX trusted_resource_project_key ON trusted_resource(kind, project_id, resource_key) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX trusted_resource_user_key ON trusted_resource(kind, resource_key) WHERE project_id IS NULL;
`;
