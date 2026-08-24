import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migration0018 } from "../src/infrastructure/migrations/migrations/0018-dense-durable-event-stream-sequences.js";
import { runStorageMigrations } from "../src/infrastructure/migrations/runner.js";

test("densifies interleaved canonical durable-event streams", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nerve-dense-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "state.sqlite");
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL, duration_ms INTEGER NOT NULL
    ) STRICT;
    INSERT INTO schema_migrations VALUES (
      1, 'canonical-storage-baseline',
      'd3275fdb99bdb4a4bbb901eeba1300dc812b74c1249f5d256562c22f64751bb2',
      1, 0
    );
    CREATE TABLE conversation_records (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE durable_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL, conversation_id TEXT, record_id TEXT,
      record_revision INTEGER, intent_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL, payload_version INTEGER NOT NULL,
      data BLOB NOT NULL, occurred_at_ms INTEGER NOT NULL
    ) STRICT;
  `);
  const insert = database.prepare(
    `INSERT INTO durable_events (
       stream, conversation_id, record_id, record_revision, intent_id,
       event_type, payload_version, data, occurred_at_ms
     ) VALUES (?, NULL, NULL, NULL, ?, 'test.event', 1, ?, ?)`,
  );
  for (const [stream, id, value] of [
    ["workspace", "w1", 1],
    ["conv/a", "a1", 2],
    ["workspace", "w2", 3],
    ["internal/conv/a", "i1", 4],
    ["conv/a", "a2", 5],
  ] as const) {
    insert.run(stream, id, Buffer.from(JSON.stringify({ value })), value);
  }
  database.close();

  const report = await runStorageMigrations(root, {
    registry: [migration0018],
  });
  assert.equal(report.executions[0]?.execution, "ran");

  const migrated = new DatabaseSync(path);
  const rows = migrated
    .prepare(
      `SELECT row_id, stream, stream_sequence, intent_id, data
       FROM durable_events ORDER BY row_id`,
    )
    .all() as unknown as Array<{
    row_id: number;
    stream: string;
    stream_sequence: number;
    intent_id: string;
    data: Uint8Array;
  }>;
  assert.deepEqual(
    rows.map(({ row_id, stream, stream_sequence, intent_id }) => ({
      row_id,
      stream,
      stream_sequence,
      intent_id,
    })),
    [
      { row_id: 1, stream: "workspace", stream_sequence: 1, intent_id: "w1" },
      { row_id: 2, stream: "conv/a", stream_sequence: 1, intent_id: "a1" },
      { row_id: 3, stream: "workspace", stream_sequence: 2, intent_id: "w2" },
      {
        row_id: 4,
        stream: "internal/conv/a",
        stream_sequence: 1,
        intent_id: "i1",
      },
      { row_id: 5, stream: "conv/a", stream_sequence: 2, intent_id: "a2" },
    ],
  );
  assert.deepEqual(
    rows.map((row) => JSON.parse(Buffer.from(row.data).toString())),
    [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }],
  );
  migrated.close();
});
