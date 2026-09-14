export const TIMELINE_EFFECT_CAPABILITY_V12_SQL = `
ALTER TABLE logical_effects ADD COLUMN capability_json BLOB;
`;
