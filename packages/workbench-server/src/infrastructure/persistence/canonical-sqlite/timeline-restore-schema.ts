export const TIMELINE_RESTORE_V8_SQL = `
CREATE TABLE restore_promotions (
  restore_id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL,
  namespace_id TEXT NOT NULL,
  prior_execution_incarnation_id TEXT NOT NULL,
  promoted_execution_incarnation_id TEXT NOT NULL UNIQUE,
  old_runtime_isolation TEXT NOT NULL CHECK(old_runtime_isolation IN ('proven','unproven')),
  dispatch_state TEXT NOT NULL CHECK(dispatch_state IN ('quarantined','disabled','admitted')),
  quarantined_run_count INTEGER NOT NULL CHECK(quarantined_run_count >= 0),
  quarantine_manifest_digest TEXT NOT NULL,
  data BLOB NOT NULL,
  promoted_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE runtime_admission (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  execution_incarnation_id TEXT NOT NULL UNIQUE,
  dispatch_state TEXT NOT NULL CHECK(dispatch_state IN ('quarantined','disabled','admitted')),
  restore_id TEXT,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(restore_id) REFERENCES restore_promotions(restore_id) ON DELETE RESTRICT
) STRICT;
INSERT INTO runtime_admission (
  singleton, execution_incarnation_id, dispatch_state, restore_id, updated_at_ms
)
SELECT 1, execution_incarnation_id, 'admitted', NULL, promoted_at_ms
FROM state_identity WHERE singleton = 1;
UPDATE state_identity SET format_version = 8
  WHERE singleton = 1 AND format_version < 8;
`;
