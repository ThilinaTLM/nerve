import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts";
import { ProtocolSessionQueue } from "../src/protocol/session-queue.js";

const ts = "2026-06-26T12:00:00.000Z";

function transient(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    seq,
    id: `evt_${seq}`,
    ts,
    type,
    durability: "transient",
    data,
  };
}

describe("protocol session queue coalescing", () => {
  it("keeps the latest subscription usage update per provider", () => {
    const queue = new ProtocolSessionQueue();
    queue.enqueueLive(
      transient(1, "usage.subscription.updated", { provider: "anthropic" }),
    );
    queue.enqueueLive(
      transient(2, "usage.subscription.updated", { provider: "anthropic" }),
    );

    assert.equal(queue.coalesceTransientOverflow(1), 1);
    assert.equal(queue.stats().coalescedTransientCount, 1);
    assert.deepEqual(
      queue.shiftTransient(10).map((event) => event.seq),
      [2],
    );
  });

  it("concatenates adjacent live content deltas for the same block", () => {
    const queue = new ProtocolSessionQueue();
    const base = {
      conversationId: "conv_1",
      runId: "run_1",
      turnId: "turn_1",
      liveMessageId: "msg_1",
      contentBlockId: "block_1",
      contentIndex: 0,
      kind: "text",
    };
    queue.enqueueLive(
      transient(1, "conversation.live.content.delta", {
        ...base,
        offset: 0,
        delta: "hel",
      }),
    );
    queue.enqueueLive(
      transient(2, "conversation.live.content.delta", {
        ...base,
        offset: 3,
        delta: "lo",
      }),
    );

    assert.equal(queue.coalesceTransientOverflow(1), 1);
    const [event] = queue.shiftTransient(10);
    assert.equal(event?.seq, 2);
    assert.deepEqual(event?.data, { ...base, offset: 0, delta: "hello" });
  });

  it("falls back to dropping when events cannot be coalesced", () => {
    const queue = new ProtocolSessionQueue();
    queue.enqueueLive(transient(1, "conversation.live.message.started", {}));
    queue.enqueueLive(transient(2, "conversation.live.message.started", {}));

    assert.equal(queue.coalesceTransientOverflow(1), 0);
    queue.dropTransientOverflow(1);
    assert.equal(queue.stats().droppedTransientCount, 1);
    assert.deepEqual(
      queue.shiftTransient(10).map((event) => event.seq),
      [2],
    );
  });
});
