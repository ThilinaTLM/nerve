import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StructuredLogLevel, StructuredLogRecord } from "@nervekit/shared";
import { LogRingBuffer } from "../src/observability/log-ring-buffer.js";

function record(
  level: StructuredLogLevel,
  message: string,
  extra: Record<string, unknown> = {},
): StructuredLogRecord {
  return { ts: new Date().toISOString(), level, message, ...extra };
}

describe("LogRingBuffer", () => {
  it("assigns monotonic seq and evicts beyond capacity", () => {
    const buffer = new LogRingBuffer(3);
    for (let i = 0; i < 5; i++) buffer.push(record("info", `m${i}`));
    const { logs, dropped, nextCursor } = buffer.query();
    assert.deepEqual(
      logs.map((l) => l.message),
      ["m2", "m3", "m4"],
    );
    assert.deepEqual(
      logs.map((l) => l.seq),
      [3, 4, 5],
    );
    assert.equal(dropped, 2);
    assert.equal(nextCursor, 5);
  });

  it("filters by minimum level", () => {
    const buffer = new LogRingBuffer();
    buffer.push(record("debug", "d"));
    buffer.push(record("info", "i"));
    buffer.push(record("warn", "w"));
    buffer.push(record("error", "e"));
    assert.deepEqual(
      buffer.query({ level: "warn" }).logs.map((l) => l.message),
      ["w", "e"],
    );
  });

  it("filters by case-insensitive message substring", () => {
    const buffer = new LogRingBuffer();
    buffer.push(record("info", "controller session connected"));
    buffer.push(record("error", "forwarded command TIMED OUT"));
    assert.deepEqual(
      buffer.query({ contains: "timed out" }).logs.map((l) => l.message),
      ["forwarded command TIMED OUT"],
    );
  });

  it("supports cursor tailing via sinceSeq", () => {
    const buffer = new LogRingBuffer();
    buffer.push(record("info", "a"));
    buffer.push(record("info", "b"));
    const first = buffer.query();
    assert.equal(first.nextCursor, 2);
    buffer.push(record("info", "c"));
    const next = buffer.query({ sinceSeq: first.nextCursor });
    assert.deepEqual(
      next.logs.map((l) => l.message),
      ["c"],
    );
    assert.equal(next.nextCursor, 3);
  });

  it("limit returns the most recent records", () => {
    const buffer = new LogRingBuffer();
    for (let i = 0; i < 10; i++) buffer.push(record("info", `m${i}`));
    const { logs } = buffer.query({ limit: 2 });
    assert.deepEqual(
      logs.map((l) => l.message),
      ["m8", "m9"],
    );
  });

  it("nextCursor holds steady when no records match", () => {
    const buffer = new LogRingBuffer();
    buffer.push(record("info", "a"));
    const result = buffer.query({ sinceSeq: 5 });
    assert.deepEqual(result.logs, []);
    assert.equal(result.nextCursor, 5);
  });
});
