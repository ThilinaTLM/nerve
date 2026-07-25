import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
  SequencedWorkbenchEvent,
  WorkbenchNotifyEvent,
} from "./event-bus";
import {
  applyEventAndFlush,
  clearEventHandlers,
  enqueueNotify,
  flushNotifyEvents,
  onAnyEvent,
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
