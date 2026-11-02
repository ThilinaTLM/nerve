/** Removes executable command-block preparation (feature removed after v0.38.1). */
export const coreSchemaV3 = `
ALTER TABLE input_queue DROP COLUMN command_preparation;
ALTER TABLE input_queue DROP COLUMN prepared_text;
`;
