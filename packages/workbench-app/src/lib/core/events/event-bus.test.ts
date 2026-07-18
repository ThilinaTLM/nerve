import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
  SequencedWorkbenchEvent,
  WorkbenchNotifyEvent,
} from "./event-bus";
import {
  applyEventAndFlush,
  clearEventHandlers,
  dispatchEvent,
  enqueueNotify,
  flushNotifyEvents,
  onAnyEvent,
  onEvent,
  onEventsFlushed,
  pendingNotifyCount,
} from "./event-bus";

const ts = "2026-07-18T00:00:00.000Z";

function event(type: string, seq = 1): SequencedWorkbenchEvent {
  return { seq, id: `evt_${seq}`, ts, type, data: {} };
}

function notify(type: string, id = "evt_notify"): WorkbenchNotifyEvent {
  return { id, ts, type, data: {} };
}

afterEach(() => clearEventHandlers());

describe("workbench event bus", () => {
  it("dispatches sequenced events immediately", () => {
    const seen: number[] = [];
    onAnyEvent((candidate) => {
      if ("seq" in candidate) seen.push(candidate.seq);
    });
    dispatchEvent(event("project.created", 1));
    dispatchEvent(event("project.created", 2));
    assert.deepEqual(seen, [1, 2]);
  });

  it("routes matching and any handlers", () => {
    const seen: string[] = [];
    onEvent("task.output", () => {
      seen.push("typed");
    });
    onAnyEvent(() => {
      seen.push("any");
    });
    dispatchEvent(notify("task.output"));
    assert.deepEqual(seen, ["typed", "any"]);
  });

  it("frame-coalesces notify events without sequence metadata", () => {
    const seen: string[] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.id);
      assert.equal("seq" in candidate, false);
    });
    enqueueNotify(notify("task.output", "evt_notify_1"));
    enqueueNotify(notify("task.output", "evt_notify_2"));
    assert.equal(pendingNotifyCount(), 2);
    flushNotifyEvents();
    assert.deepEqual(seen, ["evt_notify_1", "evt_notify_2"]);
    assert.equal(pendingNotifyCount(), 0);
  });

  it("reports notify flush batches", () => {
    const flushed: string[][] = [];
    onEventsFlushed((events) => flushed.push(events.map(({ id }) => id)));
    enqueueNotify(notify("task.output", "evt_notify_1"));
    enqueueNotify(notify("task.output", "evt_notify_2"));
    flushNotifyEvents();
    assert.deepEqual(flushed, [["evt_notify_1", "evt_notify_2"]]);
  });

  it("awaits reducers before reporting durable application", async () => {
    const order: string[] = [];
    onAnyEvent(async () => {
      order.push("reducer:start");
      await Promise.resolve();
      order.push("reducer:end");
    });
    onEventsFlushed(() => order.push("flushed"));
    await applyEventAndFlush(event("project.created"));
    assert.deepEqual(order, ["reducer:start", "reducer:end", "flushed"]);
  });

  it("surfaces reducer failures so cursors cannot advance", async () => {
    onAnyEvent(() => {
      throw new Error("reducer failed");
    });
    await assert.rejects(
      applyEventAndFlush(event("project.created")),
      /reducer failed/,
    );
  });
});
