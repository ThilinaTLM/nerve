import type { DatabaseSync } from "node:sqlite";
import { runRecordSchema } from "@nervekit/contracts/runs";
import { decode } from "./payload-codecs.js";

/** Authoritative, bounded read: never returns or decodes the retained run state. */
export function findCanonicalRunByInitialInputId(
  database: DatabaseSync,
  agentId: string,
  inputId: string,
): unknown | undefined {
  const row = database
    .prepare(
      `SELECT id, run_id, agent_id, conversation_id, revision, status,
            json_extract(CAST(data AS TEXT), '$.run') AS metadata
     FROM conversation_records
     WHERE kind = 'run' AND agent_id = ?
       AND json_extract(CAST(data AS TEXT), '$.run.initialInputId') = ?
     ORDER BY sequence, id LIMIT 1`,
    )
    .get(agentId, inputId) as
    | {
        id: string;
        run_id: string | null;
        agent_id: string;
        conversation_id: string;
        revision: number;
        status: string;
        metadata: string | null;
      }
    | undefined;
  if (!row) return undefined;
  const metadata: unknown = row.metadata === null ? null : decode(row.metadata);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Invalid run initial input lookup metadata");
  }
  const run = runRecordSchema.parse(metadata);
  if (
    run.runId !== row.id ||
    run.runId !== row.run_id ||
    run.agentId !== row.agent_id ||
    run.agentId !== agentId ||
    run.conversationId !== row.conversation_id ||
    run.scopeId !== `${row.conversation_id}:${agentId}` ||
    run.initialInputId !== inputId ||
    run.revision !== row.revision ||
    run.status !== row.status
  ) {
    throw new Error("Run initial input lookup source identity mismatch");
  }
  return run;
}

export function listCanonicalRunMetadata(database: DatabaseSync): unknown[] {
  const rows = database
    .prepare(
      `SELECT COALESCE(
                projection.data,
                CAST(json_extract(CAST(record.data AS TEXT), '$.run') AS BLOB)
              ) AS data
       FROM conversation_records AS record
       LEFT JOIN conversation_record_projections AS projection
         ON projection.record_id = record.id
       WHERE record.kind = 'run'
       ORDER BY record.updated_at_ms, record.id`,
    )
    .all() as unknown as Array<{ data: Uint8Array | string }>;
  return rows.map((row) => decode(row.data));
}

export function listCanonicalRunStates(
  database: DatabaseSync,
  statuses: string[],
): unknown[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT data FROM conversation_records
       WHERE kind = 'run' AND status IN (${placeholders})
       ORDER BY updated_at_ms, id`,
    )
    .all(...statuses) as unknown as Array<{ data: Uint8Array | string }>;
  return decodeRunStates(rows);
}

export function listCanonicalRunDeliveryRecoveryStates(
  database: DatabaseSync,
): unknown[] {
  const rows = database
    .prepare(
      `SELECT data FROM conversation_records
       WHERE kind = 'run'
         AND (
           run_delivery_settled_revision IS NULL
           OR run_delivery_settled_revision <> revision
         )
       ORDER BY updated_at_ms, id`,
    )
    .all() as unknown as Array<{ data: Uint8Array | string }>;
  return decodeRunStates(rows);
}

export function readCanonicalRunState(
  database: DatabaseSync,
  runId: string,
): unknown | undefined {
  const row = database
    .prepare(
      `SELECT data FROM conversation_records
       WHERE kind = 'run' AND id = ?`,
    )
    .get(runId) as { data: Uint8Array | string } | undefined;
  return row ? (decode(row.data) as { state?: unknown }).state : undefined;
}

function decodeRunStates(
  rows: Array<{ data: Uint8Array | string }>,
): unknown[] {
  return rows.flatMap((row) => {
    const state = (decode(row.data) as { state?: unknown }).state;
    return state === undefined ? [] : [state];
  });
}
