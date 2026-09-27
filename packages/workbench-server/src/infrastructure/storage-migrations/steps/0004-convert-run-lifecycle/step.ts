import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `INSERT INTO run_lifecycle_records (
  run_id, conversation_id, lifecycle_state, branch_epoch, revision,
  payload_version, data, updated_at_ms
)
SELECT id, conversation_id,
  CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'open'
  END,
  1, revision, payload_version, data, updated_at_ms
FROM conversation_records
WHERE kind = 'run'
ON CONFLICT(run_id) DO NOTHING;`;

export default defineSchemaStep({
  id: "0004-convert-run-lifecycle",
  description: "Backfill lifecycle rows from conversation run records.",
  run({ db }) {
    db.exec(SQL);
  },
});
