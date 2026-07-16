import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TaskLogEvent,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { appendTaskLogPage, prependTaskLogPage } from "./task-log-window.js";

const task: TaskRecord = {
  id: "task_test",
  cwd: "/workspace",
  command: "pnpm test",
  status: "running",
  readiness: { outcome: "none" },
  stdoutPath: "/tmp/stdout",
  stderrPath: "/tmp/stderr",
  logsPath: "/tmp/logs",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  origin: { kind: "api" },
  visibility: "background",
};

function event(seq: number): TaskLogEvent {
  return {
    seq,
    ts: "2026-01-01T00:00:00.000Z",
    stream: "stdout",
    level: "info",
    line: `line ${seq}`,
  };
}

function page(
  sequences: number[],
  overrides: Partial<TaskLogQueryResponse> = {},
): TaskLogQueryResponse {
  return {
    task,
    events: sequences.map(event),
    nextCursor: sequences.at(-1) ?? 0,
    hasMoreBefore: false,
    hasMoreAfter: false,
    mode: "recent",
    ...overrides,
  };
}

describe("task log window merging", () => {
  it("prepends older pages, deduplicates overlap, and keeps the live cursor", () => {
    const current = page([4, 5, 6], {
      nextCursor: 8,
      hasMoreBefore: true,
    });
    const merged = prependTaskLogPage(
      current,
      page([1, 2, 3, 4], { hasMoreBefore: false, truncated: true }),
    );
    assert.deepEqual(
      merged.events.map((item) => item.seq),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(merged.nextCursor, 8);
    assert.equal(merged.hasMoreBefore, false);
    assert.equal(merged.truncated, true);
  });

  it("appends newer pages in sequence order without duplicating delivery", () => {
    const current = page([1, 2, 3], { hasMoreBefore: false });
    const merged = appendTaskLogPage(
      current,
      page([3, 5, 4], {
        nextCursor: 5,
        hasMoreAfter: true,
      }),
    );
    assert.deepEqual(
      merged.events.map((item) => item.seq),
      [1, 2, 3, 4, 5],
    );
    assert.equal(merged.nextCursor, 5);
    assert.equal(merged.hasMoreAfter, true);
    assert.equal(merged.hasMoreBefore, false);
  });
});
