export const TIMELINE_WORK_MANIFEST_V14_SQL = `
ALTER TABLE canonical_lifecycle_work ADD COLUMN input_manifest_id TEXT;
CREATE INDEX canonical_lifecycle_work_input_manifest
  ON canonical_lifecycle_work(input_manifest_id);
`;
