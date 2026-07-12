import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxOutboxRecord } from "@nervekit/contracts";
import { chunkOutboxRecords } from "../src/protocol/session.js";

test("durable replay batches advance their predecessor", () => {
  const records = Array.from(
    { length: 205 },
    (_, index) =>
      ({
        id: `evt_${index + 11}`,
        seq: index + 11,
        type: "run.started",
        ts: "2026-01-01T00:00:00.000Z",
        durability: "durable",
        data: {},
      }) as SandboxOutboxRecord,
  );
  const batches = chunkOutboxRecords(records, 10);
  assert.deepEqual(
    batches.map((batch) => [
      batch.previousDurableSeq,
      batch.records.at(-1)?.seq,
    ]),
    [
      [10, 110],
      [110, 210],
      [210, 215],
    ],
  );
});
