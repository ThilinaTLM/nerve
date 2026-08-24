import {
  CANONICAL_SCHEMA_CHECKSUM,
  CANONICAL_SCHEMA_VERSION,
} from "../../canonical-store/schema.js";
import { pathExists } from "../../storage/json.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const manifest =
  "0018-dense-durable-event-stream-sequences|v1|Rebuild durable events with dense per-stream protocol sequences";

export const migration0018: StorageMigration = {
  id: "0018-dense-durable-event-stream-sequences",
  description: "Give durable events dense per-stream protocol sequences",
  checksum: migrationChecksum(manifest),
  async detect(context) {
    if (!(await pathExists(context.paths.sqlitePath))) return "pending";
    return context.withDatabase((database) => {
      const ledger = database
        .prepare(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get() as { present?: number } | undefined;
      // Fresh legacy imports are created directly at the current baseline by
      // migration 0017, so this migration has no independent work there.
      if (ledger?.present !== 1) return "current";
      const row = database
        .prepare(`SELECT version FROM schema_migrations WHERE version = ?`)
        .get(CANONICAL_SCHEMA_VERSION) as { version?: number } | undefined;
      return row?.version === CANONICAL_SCHEMA_VERSION ? "current" : "pending";
    });
  },
  async backup() {
    return {
      paths: ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm"],
    };
  },
  async up(context) {
    const now = context.now().getTime();
    context.transaction((database) => {
      database.exec(`
        CREATE TABLE durable_event_stream_counters_new (
          stream TEXT PRIMARY KEY,
          next_sequence INTEGER NOT NULL CHECK(next_sequence > 0)
        ) STRICT;

        CREATE TABLE durable_events_new (
          row_id INTEGER PRIMARY KEY AUTOINCREMENT,
          stream TEXT NOT NULL,
          stream_sequence INTEGER NOT NULL CHECK(stream_sequence > 0),
          conversation_id TEXT,
          record_id TEXT,
          record_revision INTEGER,
          intent_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          payload_version INTEGER NOT NULL CHECK(payload_version > 0),
          data BLOB NOT NULL,
          occurred_at_ms INTEGER NOT NULL,
          UNIQUE(stream, stream_sequence),
          FOREIGN KEY(record_id) REFERENCES conversation_records(id) ON DELETE CASCADE
        ) STRICT;

        INSERT INTO durable_events_new (
          row_id, stream, stream_sequence, conversation_id, record_id,
          record_revision, intent_id, event_type, payload_version, data,
          occurred_at_ms
        )
        SELECT sequence, stream,
               ROW_NUMBER() OVER (PARTITION BY stream ORDER BY sequence),
               conversation_id, record_id, record_revision, intent_id,
               event_type, payload_version, data, occurred_at_ms
        FROM durable_events
        ORDER BY sequence;

        INSERT INTO durable_event_stream_counters_new (stream, next_sequence)
        SELECT stream, MAX(stream_sequence) + 1
        FROM durable_events_new GROUP BY stream;

        DROP TABLE durable_events;
        ALTER TABLE durable_events_new RENAME TO durable_events;
        ALTER TABLE durable_event_stream_counters_new
          RENAME TO durable_event_stream_counters;

        CREATE INDEX durable_events_stream_sequence
          ON durable_events(stream, stream_sequence);
        CREATE INDEX durable_events_conversation_sequence
          ON durable_events(conversation_id, stream_sequence);
      `);
      database
        .prepare(
          `INSERT INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, 'dense-durable-event-stream-sequences', ?, ?, 0)`,
        )
        .run(CANONICAL_SCHEMA_VERSION, CANONICAL_SCHEMA_CHECKSUM, now);
    });
  },
  async verify(context) {
    context.withDatabase((database) => {
      const ledger = database
        .prepare(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get() as { present?: number } | undefined;
      if (ledger?.present !== 1) return;
      const schema = database
        .prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`)
        .get(CANONICAL_SCHEMA_VERSION) as { checksum?: string } | undefined;
      if (schema?.checksum !== CANONICAL_SCHEMA_CHECKSUM) {
        throw new Error("Dense durable-event schema ledger entry is missing.");
      }
      const sparse = database
        .prepare(
          `SELECT stream FROM durable_events GROUP BY stream
           HAVING MIN(stream_sequence) <> 1
              OR MAX(stream_sequence) <> COUNT(*)
              OR COUNT(DISTINCT stream_sequence) <> COUNT(*)
           LIMIT 1`,
        )
        .get();
      if (sparse)
        throw new Error("Durable event stream sequence migration is sparse.");
      const badCounter = database
        .prepare(
          `SELECT events.stream
           FROM (
             SELECT stream, MAX(stream_sequence) + 1 AS expected
             FROM durable_events GROUP BY stream
           ) events
           LEFT JOIN durable_event_stream_counters counters
             ON counters.stream = events.stream
           WHERE counters.next_sequence <> events.expected
              OR counters.next_sequence IS NULL
           LIMIT 1`,
        )
        .get();
      if (badCounter)
        throw new Error("Durable event stream counter is invalid.");
    });
  },
};
