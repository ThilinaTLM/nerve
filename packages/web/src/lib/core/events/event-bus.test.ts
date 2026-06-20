import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { WorkbenchEvent } from "./event-bus";
import {
  clearEventHandlers,
  dispatchEvent,
  enqueueEvent,
  flushEvents,
  onAnyEvent,
  onEvent,
} from "./event-bus";

function event(type: string, seq = 1): WorkbenchEvent {
  return {
    id: `evt-${type}-${seq}`,
    type,
    seq,
    ts: new Date().toISOString(),
    durability: "transient",
    data: {},
  };
}

afterEach(() => clearEventHandlers());

describe("event bus", () => {
  it("dispatches exact-type and global handlers", () => {
    const seen: string[] = [];
    onEvent("project.created", (candidate) => {
      seen.push(`specific:${candidate.type}`);
    });
    onAnyEvent((candidate) => {
      seen.push(`any:${candidate.type}`);
    });

    dispatchEvent(event("project.created"));

    assert.deepEqual(seen, ["specific:project.created", "any:project.created"]);
  });

  it("unsubscribes handlers", () => {
    const seen: string[] = [];
    const unsubscribe = onEvent("project.created", () => {
      seen.push("called");
    });

    unsubscribe();
    dispatchEvent(event("project.created"));

    assert.deepEqual(seen, []);
  });

  it("buffers enqueued events and flushes them in FIFO order", () => {
    const seen: number[] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.seq);
    });

    enqueueEvent(event("content.delta", 1));
    enqueueEvent(event("content.delta", 2));
    enqueueEvent(event("content.delta", 3));

    // Nothing is delivered until the queue is flushed.
    assert.deepEqual(seen, []);

    flushEvents();

    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("flushEvents is a no-op when the queue is empty", () => {
    const seen: number[] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.seq);
    });
    flushEvents();
    assert.deepEqual(seen, []);
  });
});
