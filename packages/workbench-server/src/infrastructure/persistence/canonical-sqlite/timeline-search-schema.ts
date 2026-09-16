export const TIMELINE_SEARCH_PROJECTION_SQL = `
CREATE VIRTUAL TABLE timeline_search_projection_rows USING fts5(
  conversation_id UNINDEXED,
  source_revision UNINDEXED,
  entry_id UNINDEXED,
  ancestry_depth UNINDEXED,
  searchable_text,
  entry_data UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE INDEX IF NOT EXISTS projection_state_pending
  ON projection_state(projection_name, oldest_pending_at_ms, conversation_id);
UPDATE state_identity SET format_version = 7
  WHERE singleton = 1 AND format_version = 6;
`;
