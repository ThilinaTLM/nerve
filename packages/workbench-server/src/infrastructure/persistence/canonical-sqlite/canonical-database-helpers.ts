import { DatabaseSync } from "node:sqlite";
import type { CanonicalDocument } from "./canonical-database.js";
import { decode, encode } from "./payload-codecs.js";
import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_V1_CHECKSUM,
  CANONICAL_SCHEMA_V2_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "./schema.js";

export interface DocumentRow {
  revision: number;
  payload_version: number;
  data: Uint8Array | string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DurableEventRow {
  stream_sequence: number;
  stream: string;
  intent_id: string;
  event_type: string;
  data: Uint8Array | string;
  occurred_at_ms: number;
}

export function assertCanonicalSchemaCompatible(
  rows: Array<{ version: number; checksum: string }>,
): void {
  const newest = rows.at(-1);
  if (!newest) throw new Error("Storage schema migration ledger is empty.");
  if (newest.version > CANONICAL_SCHEMA_VERSION) {
    throw new Error(
      `Storage schema ${newest.version} is newer than supported schema ${CANONICAL_SCHEMA_VERSION}.`,
    );
  }
  const checksums = new Map([
    [1, CANONICAL_SCHEMA_V1_CHECKSUM],
    [2, CANONICAL_SCHEMA_V2_CHECKSUM],
    [CANONICAL_SCHEMA_VERSION, CANONICAL_SCHEMA_CHECKSUM],
  ]);
  for (const row of rows) {
    const expected = checksums.get(row.version);
    if (!expected) {
      throw new Error(`Storage schema version ${row.version} is unsupported.`);
    }
    if (row.checksum !== expected) {
      throw new Error(
        `Storage schema checksum drift at version ${row.version}.`,
      );
    }
  }
}

export function applySchemaMigration(
  database: DatabaseSync,
  version: number,
  name: string,
  checksum: string,
  sql: string,
): void {
  const startedAt = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database
      .prepare(
        `INSERT INTO schema_migrations (
           version, name, checksum, applied_at_ms, duration_ms
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(version, name, checksum, Date.now(), Date.now() - startedAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function ownedBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === "string"
    ? new TextEncoder().encode(value)
    : Uint8Array.from(value);
}

export function appendDurableEventInTransaction(
  database: DatabaseSync,
  input: {
    stream: string;
    intentId: string;
    eventType: string;
    data: unknown;
    occurredAt: string;
    conversationId?: string;
  },
): { sequence: number; intentId: string } {
  const existing = database
    .prepare(
      `SELECT stream_sequence, stream, event_type, data
       FROM durable_events WHERE intent_id = ?`,
    )
    .get(input.intentId) as
    | {
        stream_sequence: number;
        stream: string;
        event_type: string;
        data: Uint8Array | string;
      }
    | undefined;
  if (existing) {
    if (
      existing.stream !== input.stream ||
      existing.event_type !== input.eventType ||
      JSON.stringify(decode(existing.data)) !== JSON.stringify(input.data)
    ) {
      throw new Error(`Conflicting event intent id: ${input.intentId}`);
    }
    return { sequence: existing.stream_sequence, intentId: input.intentId };
  }

  database
    .prepare(
      `INSERT INTO durable_event_stream_counters (stream, next_sequence)
       VALUES (?, 1) ON CONFLICT(stream) DO NOTHING`,
    )
    .run(input.stream);
  const counter = database
    .prepare(
      `SELECT next_sequence FROM durable_event_stream_counters WHERE stream = ?`,
    )
    .get(input.stream) as { next_sequence: number };
  const sequence = counter.next_sequence;
  database
    .prepare(
      `INSERT INTO durable_events (
         stream, stream_sequence, conversation_id, record_id, record_revision,
         intent_id, event_type, payload_version, data, occurred_at_ms
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.stream,
      sequence,
      input.conversationId ?? null,
      input.intentId,
      input.eventType,
      encode(input.data),
      Date.parse(input.occurredAt),
    );
  database
    .prepare(
      `UPDATE durable_event_stream_counters SET next_sequence = ? WHERE stream = ?`,
    )
    .run(sequence + 1, input.stream);
  return { sequence, intentId: input.intentId };
}

export function decodeDocument<T>(
  namespace: string,
  scopeId: string,
  documentId: string,
  row: DocumentRow,
): CanonicalDocument<T> {
  return {
    namespace,
    scopeId,
    documentId,
    revision: row.revision,
    payloadVersion: row.payload_version,
    data: decode(row.data) as T,
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  };
}

export function decodeDurableEvent(row: DurableEventRow) {
  return {
    sequence: row.stream_sequence,
    stream: row.stream,
    intentId: row.intent_id,
    eventType: row.event_type,
    data: decode(row.data),
    occurredAt: new Date(row.occurred_at_ms).toISOString(),
  };
}
