import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { WorkbenchEvent } from "./event-bus";
import {
  applyEventAndFlush,
  clearEventHandlers,
  dispatchEvent,
  enqueueEvent,
  flushEvents,
  onAnyEvent,
  onEvent,
  onEventsFlushed,
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

  it("delivers events enqueued by a handler in FIFO order during a flush", () => {
    const seen: number[] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.seq);
      if (candidate.seq === 1) enqueueEvent(event("content.delta", 2));
    });

    enqueueEvent(event("content.delta", 1));
    flushEvents();

    assert.deepEqual(seen, [1, 2]);
  });

  it("notifies flush observers after dispatch including events enqueued during flush", () => {
    const seen: number[] = [];
    const flushed: number[][] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.seq);
      if (candidate.seq === 1) enqueueEvent(event("content.delta", 2));
    });
    onEventsFlushed((events) => {
      flushed.push(events.map((candidate) => candidate.seq));
    });

    enqueueEvent(event("content.delta", 1));
    flushEvents();

    assert.deepEqual(seen, [1, 2]);
    assert.deepEqual(flushed, [[1, 2]]);
  });

  it("awaits reducers before notifying durable flush observers", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onEvent("project.created", async () => {
      order.push("reducer:start");
      await gate;
      order.push("reducer:end");
    });
    onEventsFlushed(() => order.push("flushed"));

    const applying = applyEventAndFlush(event("project.created"));
    await Promise.resolve();
    assert.deepEqual(order, ["reducer:start"]);
    release();
    await applying;
    assert.deepEqual(order, ["reducer:start", "reducer:end", "flushed"]);
  });

  it("propagates reducer failure without notifying flush observers", async () => {
    let flushed = false;
    onEvent("project.created", () => {
      throw new Error("reducer failed");
    });
    onEventsFlushed(() => {
      flushed = true;
    });
    await assert.rejects(
      applyEventAndFlush(event("project.created")),
      /reducer failed/,
    );
    assert.equal(flushed, false);
  });

  it("applies buffered transient events before a durable event (websocket routing)", async () => {
    // Mirrors the protocol client's applyEvent path: transient events are
    // enqueued for frame-coalesced delivery, while a durable event first
    // drains the queue synchronously and then applies itself, so durable
    // acks always reflect a fully ordered application.
    const seen: string[] = [];
    onAnyEvent((candidate) => {
      seen.push(`${candidate.type}:${candidate.seq}`);
    });

    enqueueEvent(event("conversation.live.content.delta", 1));
    enqueueEvent(event("conversation.live.content.delta", 2));
    assert.deepEqual(seen, []);

    const durable: WorkbenchEvent = {
      ...event("run.completed", 3),
      durability: "durable",
    };
    flushEvents();
    await applyEventAndFlush(durable);

    assert.deepEqual(seen, [
      "conversation.live.content.delta:1",
      "conversation.live.content.delta:2",
      "run.completed:3",
    ]);
  });

  it("clearEventHandlers removes buffered events", () => {
    const seen: number[] = [];
    onAnyEvent((candidate) => {
      seen.push(candidate.seq);
    });
    enqueueEvent(event("content.delta", 1));

    clearEventHandlers();
    flushEvents();

    assert.deepEqual(seen, []);
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
