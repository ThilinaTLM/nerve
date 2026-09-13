export const TIMELINE_DELETION_WORK_V6_SQL = `
CREATE TABLE artifact_deletion_work (
  work_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  preparation_id TEXT NOT NULL,
  relative_locator TEXT NOT NULL,
  expected_digest TEXT NOT NULL,
  expected_byte_length INTEGER NOT NULL CHECK(expected_byte_length >= 0),
  state TEXT NOT NULL CHECK(state IN ('planned','deleting','deleted','missing','failed')),
  attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
  last_error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(conversation_id, preparation_id),
  FOREIGN KEY(conversation_id) REFERENCES deletion_intents(conversation_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX artifact_deletion_work_pending
  ON artifact_deletion_work(conversation_id, state, work_id);
UPDATE state_identity SET format_version = 6
  WHERE singleton = 1 AND format_version = 5;
`;
