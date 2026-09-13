export const TIMELINE_AUTHORITY_PROMOTION_V9_SQL = `
CREATE TABLE timeline_authority_promotions (
  promotion_id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL,
  prior_incarnation_id TEXT NOT NULL,
  incarnation_id TEXT NOT NULL UNIQUE,
  proof_digest TEXT NOT NULL,
  old_runtime_isolated INTEGER NOT NULL CHECK(old_runtime_isolated = 1),
  state TEXT NOT NULL CHECK(state = 'promoted'),
  promoted_at_ms INTEGER NOT NULL
) STRICT;
`;
