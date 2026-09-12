export const UNIFIED_TIMELINE_V5_SQL = `
CREATE TABLE state_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  namespace_id TEXT NOT NULL UNIQUE,
  execution_incarnation_id TEXT NOT NULL UNIQUE,
  format_version INTEGER NOT NULL CHECK(format_version > 0),
  promoted_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  active_entry_id TEXT,
  selection_epoch INTEGER NOT NULL CHECK(selection_epoch >= 0),
  foreground_run_id TEXT,
  deletion_state TEXT NOT NULL CHECK(deletion_state IN ('active','pending','finalized')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(conversation_id, active_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE conversation_transitions (
  transition_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  kind TEXT NOT NULL CHECK(kind IN (
    'entries_appended','selection_changed','context_boundary_committed',
    'interaction_changed','run_changed','execution_changed','history_imported'
  )),
  command_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  actor_json BLOB NOT NULL,
  cause_json BLOB NOT NULL,
  committed_at_ms INTEGER NOT NULL,
  resulting_control_json BLOB NOT NULL,
  UNIQUE(conversation_id, revision),
  UNIQUE(conversation_id, transition_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX conversation_transitions_command
  ON conversation_transitions(conversation_id, command_id);

CREATE TABLE artifact_manifests (
  manifest_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE conversation_entries (
  entry_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  parent_entry_id TEXT,
  ancestry_depth INTEGER NOT NULL CHECK(ancestry_depth >= 0),
  kind TEXT NOT NULL CHECK(kind IN (
    'user_message','assistant_message','tool_proposal','tool_result',
    'child_result','summary'
  )),
  inline_content_json BLOB,
  artifact_manifest_id TEXT,
  run_id TEXT,
  tool_call_id TEXT,
  interaction_id TEXT,
  provenance_json BLOB NOT NULL,
  UNIQUE(transition_id, ordinal),
  UNIQUE(conversation_id, entry_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, transition_id)
    REFERENCES conversation_transitions(conversation_id, transition_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, parent_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX conversation_entries_parent
  ON conversation_entries(conversation_id, parent_entry_id, entry_id);
CREATE INDEX conversation_entries_transition
  ON conversation_entries(conversation_id, transition_id, ordinal);
CREATE TABLE entry_ancestor_jumps (
  entry_id TEXT NOT NULL,
  power INTEGER NOT NULL CHECK(power >= 0 AND power < 63),
  ancestor_entry_id TEXT NOT NULL,
  PRIMARY KEY(entry_id, power),
  FOREIGN KEY(entry_id) REFERENCES conversation_entries(entry_id) ON DELETE CASCADE,
  FOREIGN KEY(ancestor_entry_id) REFERENCES conversation_entries(entry_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX entry_ancestor_jumps_ancestor
  ON entry_ancestor_jumps(ancestor_entry_id, entry_id, power);

CREATE TABLE context_boundaries (
  boundary_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  anchor_entry_id TEXT,
  source_tip_entry_id TEXT,
  source_manifest_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK(policy_version > 0),
  provider_adapter_version TEXT NOT NULL,
  recipe_version INTEGER NOT NULL CHECK(recipe_version > 0),
  visible_summary_entry_id TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, transition_id)
    REFERENCES conversation_transitions(conversation_id, transition_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, anchor_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, source_tip_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, visible_summary_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX context_boundaries_candidate
  ON context_boundaries(conversation_id, policy_version, anchor_entry_id, transition_id);

CREATE TABLE command_receipts (
  namespace_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('state','conversation','policy_scope')),
  owner_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  fingerprint_version INTEGER NOT NULL CHECK(fingerprint_version > 0),
  fingerprint_hash TEXT NOT NULL,
  outcome_version INTEGER NOT NULL CHECK(outcome_version > 0),
  outcome_json BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  content_redacted_at_ms INTEGER,
  PRIMARY KEY(namespace_id, operation_kind, owner_kind, owner_id, command_id)
) STRICT;
CREATE INDEX command_receipts_owner
  ON command_receipts(owner_kind, owner_id, created_at_ms);

CREATE TABLE run_controls (
  run_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  bound_selection_epoch INTEGER NOT NULL CHECK(bound_selection_epoch >= 0),
  continuation_entry_id TEXT,
  checkpoint_id TEXT,
  wait_group_id TEXT,
  provider_phase_id TEXT,
  effective_state TEXT NOT NULL,
  foreground_owned INTEGER NOT NULL CHECK(foreground_owned IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  recovery_reason TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(conversation_id, run_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, continuation_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX run_controls_foreground_owner
  ON run_controls(conversation_id) WHERE foreground_owned = 1;

CREATE TABLE execution_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  compatibility_version TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  model_context_recipe_version INTEGER NOT NULL CHECK(model_context_recipe_version > 0),
  opaque_provider_state_manifest_id TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES run_controls(run_id) ON DELETE RESTRICT,
  FOREIGN KEY(manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT,
  FOREIGN KEY(opaque_provider_state_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  capture_revision INTEGER NOT NULL CHECK(capture_revision >= 0),
  capture_transition_id TEXT NOT NULL,
  anchor_entry_id TEXT,
  selection_epoch INTEGER NOT NULL CHECK(selection_epoch >= 0),
  run_generation INTEGER NOT NULL CHECK(run_generation > 0),
  execution_phase TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  pending_manifest_id TEXT NOT NULL,
  wait_group_id TEXT NOT NULL,
  context_recipe_version INTEGER NOT NULL CHECK(context_recipe_version > 0),
  integrity_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, run_id)
    REFERENCES run_controls(conversation_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, capture_transition_id)
    REFERENCES conversation_transitions(conversation_id, transition_id) ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id, anchor_entry_id)
    REFERENCES conversation_entries(conversation_id, entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(snapshot_id) REFERENCES execution_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY(pending_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id, wait_group_id)
    REFERENCES wait_groups(run_id, wait_group_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE wait_groups (
  wait_group_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  membership_manifest_id TEXT NOT NULL,
  continuation_entry_id TEXT,
  continuation_consumed INTEGER NOT NULL CHECK(continuation_consumed IN (0,1)),
  effective_state TEXT NOT NULL CHECK(effective_state IN ('open','ready','closed','recovery_required')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  UNIQUE(run_id, wait_group_id),
  FOREIGN KEY(run_id) REFERENCES run_controls(run_id) ON DELETE RESTRICT,
  FOREIGN KEY(membership_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT,
  FOREIGN KEY(continuation_entry_id) REFERENCES conversation_entries(entry_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE wait_group_members (
  member_id TEXT PRIMARY KEY,
  wait_group_id TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK(member_kind IN ('tool','interaction','child_agent')),
  owner_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  policy_fingerprint TEXT,
  execution_state TEXT NOT NULL,
  attachment_disposition TEXT NOT NULL,
  result_entry_id TEXT,
  non_dispatch_evidence_id TEXT,
  barrier_contribution INTEGER NOT NULL CHECK(barrier_contribution IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  FOREIGN KEY(wait_group_id) REFERENCES wait_groups(wait_group_id) ON DELETE RESTRICT,
  FOREIGN KEY(result_entry_id) REFERENCES conversation_entries(entry_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX wait_group_member_result
  ON wait_group_members(result_entry_id) WHERE result_entry_id IS NOT NULL;
CREATE INDEX wait_group_members_barrier
  ON wait_group_members(wait_group_id, barrier_contribution, member_id);

CREATE TABLE exact_call_authorizations (
  authorization_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  normalized_input_hash TEXT NOT NULL,
  policy_observation_id TEXT NOT NULL,
  run_generation INTEGER NOT NULL CHECK(run_generation > 0),
  selection_epoch INTEGER NOT NULL CHECK(selection_epoch >= 0),
  state TEXT NOT NULL CHECK(state IN ('active','consumed','revoked','superseded')),
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(member_id) REFERENCES wait_group_members(member_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE logical_effects (
  effect_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  capability_version INTEGER NOT NULL CHECK(capability_version > 0),
  capability_kind TEXT NOT NULL,
  normalized_input_hash TEXT NOT NULL,
  owner_json BLOB NOT NULL,
  external_scope_json BLOB,
  external_key TEXT,
  authorization_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(member_id) REFERENCES wait_group_members(member_id) ON DELETE RESTRICT,
  FOREIGN KEY(authorization_id) REFERENCES exact_call_authorizations(authorization_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX logical_effect_external_key
  ON logical_effects(capability_version, external_key) WHERE external_key IS NOT NULL;

CREATE TABLE provider_phases (
  phase_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  selection_epoch INTEGER NOT NULL CHECK(selection_epoch >= 0),
  source_entry_id TEXT,
  context_recipe_id TEXT NOT NULL,
  request_manifest_id TEXT,
  request_hash TEXT,
  provider_identity_json BLOB NOT NULL,
  capability_version INTEGER NOT NULL CHECK(capability_version > 0),
  capability_kind TEXT NOT NULL,
  opaque_state_manifest_id TEXT,
  state TEXT NOT NULL,
  committed_response_id TEXT,
  recovery_admission_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES run_controls(run_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_entry_id) REFERENCES conversation_entries(entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(request_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT,
  FOREIGN KEY(opaque_state_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  effect_id TEXT,
  provider_phase_id TEXT,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  incarnation_id TEXT NOT NULL,
  state TEXT NOT NULL,
  outcome_json BLOB,
  prepared_manifest_id TEXT,
  external_locator TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK((effect_id IS NOT NULL) <> (provider_phase_id IS NOT NULL)),
  FOREIGN KEY(effect_id) REFERENCES logical_effects(effect_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_phase_id) REFERENCES provider_phases(phase_id) ON DELETE RESTRICT,
  FOREIGN KEY(prepared_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX execution_attempt_number
  ON execution_attempts(COALESCE(effect_id, provider_phase_id), attempt_number);

CREATE TABLE execution_claims (
  claim_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  incarnation_id TEXT NOT NULL,
  lease_deadline_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','consumed','revoked','expired')),
  FOREIGN KEY(attempt_id) REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX execution_claim_active
  ON execution_claims(attempt_id) WHERE state = 'active';

CREATE TABLE recovery_actions (
  action_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  member_id TEXT,
  effect_id TEXT,
  action_kind TEXT NOT NULL,
  evidence_json BLOB,
  evidence_manifest_id TEXT,
  status TEXT NOT NULL,
  command_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES run_controls(run_id) ON DELETE RESTRICT,
  FOREIGN KEY(member_id) REFERENCES wait_group_members(member_id) ON DELETE RESTRICT,
  FOREIGN KEY(effect_id) REFERENCES logical_effects(effect_id) ON DELETE RESTRICT,
  FOREIGN KEY(evidence_manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE policy_observations (
  observation_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  document_identity TEXT NOT NULL,
  complete_digest TEXT NOT NULL,
  rule_set_id TEXT NOT NULL,
  normalized_input_hash TEXT NOT NULL,
  trust_evidence_json BLOB NOT NULL,
  observed_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE policy_decisions (
  decision_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  decision_kind TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(observation_id) REFERENCES policy_observations(observation_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE policy_save_intents (
  save_intent_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  document_identity TEXT NOT NULL,
  observed_digest TEXT,
  intended_digest TEXT NOT NULL,
  rule_json BLOB NOT NULL,
  state TEXT NOT NULL,
  file_result_json BLOB,
  finalization_result_json BLOB,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE artifact_preparations (
  preparation_id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  relative_locator TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  media_type TEXT NOT NULL,
  semantic_role TEXT NOT NULL,
  lease_state TEXT NOT NULL CHECK(lease_state IN ('active','finalized','referenced','expired')),
  expires_at_ms INTEGER,
  manifest_id TEXT,
  FOREIGN KEY(manifest_id) REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX artifact_preparations_cleanup
  ON artifact_preparations(lease_state, expires_at_ms, preparation_id);

CREATE TABLE projection_state (
  projection_name TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  policy_version INTEGER NOT NULL CHECK(policy_version > 0),
  rebuild_generation INTEGER NOT NULL CHECK(rebuild_generation > 0),
  applied_revision INTEGER NOT NULL CHECK(applied_revision >= 0),
  oldest_pending_at_ms INTEGER,
  last_error_json BLOB,
  rebuild_state TEXT NOT NULL CHECK(rebuild_state IN ('ready','rebuilding','failed')),
  PRIMARY KEY(projection_name, conversation_id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE transcript_projection_rows (
  conversation_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  entry_id TEXT NOT NULL,
  ancestry_depth INTEGER NOT NULL CHECK(ancestry_depth >= 0),
  display_order_key TEXT NOT NULL,
  visibility_key TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  data BLOB NOT NULL,
  PRIMARY KEY(conversation_id, source_revision, entry_id, visibility_key),
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY(entry_id) REFERENCES conversation_entries(entry_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX transcript_projection_page
  ON transcript_projection_rows(conversation_id, source_revision, visibility_key, display_order_key);

CREATE TABLE deletion_intents (
  conversation_id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  fence_revision INTEGER NOT NULL CHECK(fence_revision >= 0),
  phase TEXT NOT NULL CHECK(phase IN (
    'fenced','settling_execution','removing_payloads','removing_history',
    'retaining_replay_evidence','finalized'
  )),
  cleanup_cursor TEXT,
  uncertainty_acknowledged INTEGER NOT NULL CHECK(uncertainty_acknowledged IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE owner_tombstones (
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  namespace_id TEXT NOT NULL,
  command_reservation_count INTEGER NOT NULL CHECK(command_reservation_count >= 0),
  effect_reservation_count INTEGER NOT NULL CHECK(effect_reservation_count >= 0),
  deleted_at_ms INTEGER NOT NULL,
  replay_evidence_json BLOB NOT NULL,
  PRIMARY KEY(owner_kind, owner_id, namespace_id)
) STRICT;
`;
