export const TIMELINE_POLICY_SAVE_V15_SQL = `
ALTER TABLE policy_save_intents ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version IN (1, 2));
ALTER TABLE policy_save_intents ADD COLUMN conversation_id TEXT;
ALTER TABLE policy_save_intents ADD COLUMN run_id TEXT;
ALTER TABLE policy_save_intents ADD COLUMN member_id TEXT;
ALTER TABLE policy_save_intents ADD COLUMN approval_command_id TEXT;
ALTER TABLE policy_save_intents ADD COLUMN intended_document_manifest_id TEXT REFERENCES artifact_manifests(manifest_id) ON DELETE RESTRICT;
CREATE INDEX policy_save_intents_recovery_v15
  ON policy_save_intents(state, updated_at_ms, save_intent_id);
CREATE INDEX policy_save_intents_member_v15
  ON policy_save_intents(member_id, state);
`;
