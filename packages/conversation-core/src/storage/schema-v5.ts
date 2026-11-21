/**
 * Accounts (docs/architecture/storage.md, "Accounts"): one row per account of an extension's
 * account definition. `project_id` is NULL for a user-level account. `credential` is the
 * encrypted blob only the credential vault reads; `status`, `expires_at` and `last_used_at` stay
 * readable without decrypting it. `kind` is the definition's id, not a foreign key.
 */
export const coreSchemaV5 = `
CREATE TABLE account (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fields TEXT NOT NULL,
  credential BLOB,
  status TEXT NOT NULL CHECK(status IN ('ready','needs_sign_in','failed')),
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX account_refresh ON account(expires_at) WHERE expires_at IS NOT NULL;
`;
