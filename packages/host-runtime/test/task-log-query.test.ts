import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskLogEvent } from "@nervekit/contracts";
import { queryTaskLogEvents } from "../src/task-log-query.js";

function events(count: number): TaskLogEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    ts: new Date(index * 1_000).toISOString(),
    stream: "stdout" as const,
    level:
      (index + 1) % 5 === 0
        ? ("error" as const)
        : (index + 1) % 3 === 0
          ? ("warn" as const)
          : ("info" as const),
    line: `line ${index + 1}`,
  }));
}

describe("task log query paging", () => {
  it("returns a recent tail and consecutive older pages", () => {
    const source = events(12);
    const recent = queryTaskLogEvents(source, { mode: "recent", limit: 5 });
    assert.deepEqual(
      recent.events.map((event) => event.seq),
      [8, 9, 10, 11, 12],
    );
    assert.equal(recent.nextCursor, 12);
    assert.equal(recent.hasMoreBefore, true);
    assert.equal(recent.hasMoreAfter, false);

    const older = queryTaskLogEvents(source, {
      mode: "recent",
      beforeSeq: 8,
      limit: 5,
    });
    assert.deepEqual(
      older.events.map((event) => event.seq),
      [3, 4, 5, 6, 7],
    );
    assert.equal(older.hasMoreBefore, true);

    const oldest = queryTaskLogEvents(source, {
      mode: "recent",
      beforeSeq: 3,
      limit: 5,
    });
    assert.deepEqual(
      oldest.events.map((event) => event.seq),
      [1, 2],
    );
    assert.equal(oldest.hasMoreBefore, false);
  });

  it("pages forward without skipping a burst larger than the limit", () => {
    const source = events(10);
    const first = queryTaskLogEvents(source, {
      mode: "since_cursor",
      sinceSeq: 2,
      limit: 3,
    });
    assert.deepEqual(
      first.events.map((event) => event.seq),
      [3, 4, 5],
    );
    assert.equal(first.nextCursor, 5);
    assert.equal(first.hasMoreAfter, true);

    const second = queryTaskLogEvents(source, {
      mode: "since_cursor",
      sinceSeq: first.nextCursor,
      limit: 3,
    });
    assert.deepEqual(
      second.events.map((event) => event.seq),
      [6, 7, 8],
    );
    assert.equal(second.nextCursor, 8);
    assert.equal(second.hasMoreAfter, true);

    const third = queryTaskLogEvents(source, {
      mode: "since_cursor",
      sinceSeq: second.nextCursor,
      limit: 3,
    });
    assert.deepEqual(
      third.events.map((event) => event.seq),
      [9, 10],
    );
    assert.equal(third.nextCursor, 10);
    assert.equal(third.hasMoreAfter, false);
  });

  it("applies severity and text filters before paging", () => {
    const page = queryTaskLogEvents(events(15), {
      mode: "warnings",
      contains: "line",
      regex: "(6|12)$",
      limit: 1,
    });
    assert.deepEqual(
      page.events.map((event) => event.seq),
      [12],
    );
    assert.equal(page.hasMoreBefore, true);
  });

  it("keeps empty incremental cursors stable", () => {
    const page = queryTaskLogEvents(events(3), {
      mode: "since_cursor",
      sinceSeq: 3,
      limit: 2,
    });
    assert.deepEqual(page.events, []);
    assert.equal(page.nextCursor, 3);
    assert.equal(page.hasMoreBefore, false);
    assert.equal(page.hasMoreAfter, false);
  });
});
