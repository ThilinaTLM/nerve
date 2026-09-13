export const TIMELINE_LIFECYCLE_WORK_V10_SQL = `
CREATE TABLE canonical_lifecycle_work (
  work_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'prepare_provider_request','claim_provider_attempt','dispatch_provider_attempt',
    'dispatch_tool_attempt','reconcile_execution'
  )),
  provider_phase_id TEXT,
  effect_id TEXT,
  attempt_id TEXT,
  execution_claim_id TEXT,
  state TEXT NOT NULL CHECK(state IN (
    'ready','leased','settled','cancelled','recovery_required'
  )),
  input_hash TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  revision INTEGER NOT NULL CHECK(revision > 0),
  not_before_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_deadline_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(
    (kind IN (
      'prepare_provider_request','claim_provider_attempt','dispatch_provider_attempt'
    )) =
    (provider_phase_id IS NOT NULL)
  ),
  CHECK(
    kind <> 'dispatch_tool_attempt' OR effect_id IS NOT NULL
  ),
  CHECK(
    (kind IN ('dispatch_provider_attempt','dispatch_tool_attempt')) =
    (attempt_id IS NOT NULL AND execution_claim_id IS NOT NULL)
  ),
  CHECK(
    (state = 'leased') =
    (lease_owner IS NOT NULL AND lease_deadline_ms IS NOT NULL)
  ),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES run_controls(run_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_phase_id) REFERENCES provider_phases(phase_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(effect_id) REFERENCES logical_effects(effect_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES execution_attempts(attempt_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(execution_claim_id) REFERENCES execution_claims(claim_id)
    ON DELETE RESTRICT
) STRICT;
CREATE INDEX canonical_lifecycle_work_ready
  ON canonical_lifecycle_work(state, not_before_ms, work_id);
CREATE INDEX canonical_lifecycle_work_run
  ON canonical_lifecycle_work(run_id, state, work_id);
CREATE UNIQUE INDEX canonical_lifecycle_work_provider_open
  ON canonical_lifecycle_work(provider_phase_id)
  WHERE provider_phase_id IS NOT NULL AND state IN ('ready','leased');
CREATE UNIQUE INDEX canonical_lifecycle_work_attempt_open
  ON canonical_lifecycle_work(attempt_id)
  WHERE attempt_id IS NOT NULL AND state IN ('ready','leased');
`;
