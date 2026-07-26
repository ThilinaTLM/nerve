import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskLogEvent } from "@nervekit/contracts";
import {
  compileTaskLogMatcher,
  emptyTaskLogFilter,
  filterTaskLogEvents,
} from "./task-log-filter.js";

function event(patch: Partial<TaskLogEvent> & { seq: number }): TaskLogEvent {
  return {
    ts: new Date().toISOString(),
    stream: "stdout",
    level: "info",
    line: "hello world",
    ...patch,
  };
}

const events: TaskLogEvent[] = [
  event({ seq: 1, line: "boot OK" }),
  event({ seq: 2, level: "warn", line: "deprecation Notice" }),
  event({ seq: 3, stream: "stderr", level: "error", line: "boom" }),
];

test("warn level includes errors, error level excludes warnings", () => {
  assert.deepEqual(
    filterTaskLogEvents(events, { ...emptyTaskLogFilter, level: "warn" }).map(
      (item) => item.seq,
    ),
    [2, 3],
  );
  assert.deepEqual(
    filterTaskLogEvents(events, { ...emptyTaskLogFilter, level: "error" }).map(
      (item) => item.seq,
    ),
    [3],
  );
});

test("stream filter keeps only the selected stream", () => {
  assert.deepEqual(
    filterTaskLogEvents(events, {
      ...emptyTaskLogFilter,
      stream: "stderr",
    }).map((item) => item.seq),
    [3],
  );
});

test("text search is case-insensitive substring matching", () => {
  assert.deepEqual(
    filterTaskLogEvents(events, { ...emptyTaskLogFilter, text: "notice" }).map(
      (item) => item.seq,
    ),
    [2],
  );
});

test("invalid regular expressions report an error and match nothing", () => {
  const matcher = compileTaskLogMatcher({
    ...emptyTaskLogFilter,
    text: "boo(",
    useRegex: true,
  });
  assert.ok(matcher.error);
  assert.equal(matcher.match(events[2] as TaskLogEvent), false);
});
