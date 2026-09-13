import type { DatabaseSync } from "node:sqlite";
import type { CommitConversationCommandInput } from "./timeline-command-contracts.js";
import { CANONICAL_SCHEMA_VERSION } from "./schema.js";

export function ensureTimelineStateIdentity(
  database: DatabaseSync,
  input: CommitConversationCommandInput,
): void {
  const row = database
    .prepare(
      `SELECT namespace_id, execution_incarnation_id FROM state_identity
       WHERE singleton = 1`,
    )
    .get() as
    | { namespace_id: string; execution_incarnation_id: string }
    | undefined;
  if (!row) {
    const timestamp = Date.parse(input.now);
    database
      .prepare(
        `INSERT INTO state_identity (
           singleton, namespace_id, execution_incarnation_id,
           format_version, promoted_at_ms
         ) VALUES (1, ?, ?, ?, ?)`,
      )
      .run(
        input.namespaceId,
        input.executionIncarnationId,
        CANONICAL_SCHEMA_VERSION,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO runtime_admission (
           singleton, execution_incarnation_id, dispatch_state,
           restore_id, updated_at_ms
         ) VALUES (1, ?, 'admitted', NULL, ?)`,
      )
      .run(input.executionIncarnationId, timestamp);
    return;
  }
  if (
    row.namespace_id !== input.namespaceId ||
    row.execution_incarnation_id !== input.executionIncarnationId
  ) {
    throw new Error("State namespace or execution incarnation does not match.");
  }
}
