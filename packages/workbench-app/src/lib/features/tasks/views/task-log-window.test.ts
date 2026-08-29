import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TaskLogEvent,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts/tasks";
import {
  appendTaskLogPage,
  MAX_TASK_LOG_WINDOW_EVENTS,
  prependTaskLogPage,
} from "./task-log-window.js";

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

  it("trims the oldest events once the window cap is exceeded", () => {
    const total = MAX_TASK_LOG_WINDOW_EVENTS + 120;
    const current = page(
      Array.from(
        { length: MAX_TASK_LOG_WINDOW_EVENTS },
        (_, index) => index + 1,
      ),
    );
    const merged = appendTaskLogPage(
      current,
      page(
        Array.from(
          { length: 120 },
          (_, index) => MAX_TASK_LOG_WINDOW_EVENTS + index + 1,
        ),
      ),
    );
    assert.equal(merged.events.length, MAX_TASK_LOG_WINDOW_EVENTS);
    assert.equal(merged.events[0]?.seq, 121);
    assert.equal(merged.events.at(-1)?.seq, total);
    assert.equal(merged.hasMoreBefore, true);
  });
});
