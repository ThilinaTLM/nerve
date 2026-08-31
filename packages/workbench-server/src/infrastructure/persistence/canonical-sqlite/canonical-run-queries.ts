import type { DatabaseSync } from "node:sqlite";
import { decode } from "./payload-codecs.js";

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
