import assert from "node:assert/strict";
import { it } from "node:test";
import type { ConversationEvent, LiveDelta } from "@nervekit/contracts/core";
import { ToolArgumentDelivery } from "./tool-argument-delivery.js";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const delta = (
  text: string,
  turnId = "turn1",
  contentIndex = 0,
  providerCallId = "call1",
): Extract<LiveDelta, { type: "tool_call_arguments" }> => ({
  type: "tool_call_arguments",
  turnId,
  contentIndex,
  providerCallId,
  name: "write",
  partialArgsText: text,
});
const assistant = (turnId = "turn1") =>
  ({
    type: "assistant_message",
    turnId,
    payload: { content: [] },
  }) as unknown as ConversationEvent;
const transition = (value: string) =>
  ({
    type: "system_event",
    payload: { subtype: "execution_state", transition: value },
  }) as unknown as ConversationEvent;
function fixture(flush?: () => Promise<void>) {
  const sent: string[] = [];
  const active = new Set(["a", "b"]);
  let now = 0;
  const timers = new Map<symbol, () => void>();
  const delivery = new ToolArgumentDelivery({
    active: (id) => active.has(id),
    notify: async ({ conversationId, delta }) => {
      sent.push(
        `${conversationId}:${delta.turnId}:${delta.contentIndex}:${delta.partialArgsText}`,
      );
    },
    flush: async () => {
      await flush?.();
      sent.push("flush");
    },
    onError: (error) => {
      throw error;
    },
    clock: { now: () => now, isoNow: () => "" },
    timers: {
      setTimeout: (callback) => {
        const id = Symbol();
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id as symbol);
      },
      setInterval: () => Symbol(),
      clearInterval: () => {},
    },
  });
  return {
    delivery,
    sent,
    active,
    tick: async () => {
      now += 50;
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
      await settle();
    },
  };
}

void it("isolates conversations, parallel calls, and turns while retaining latest prefixes", async () => {
  const f = fixture();
  f.delivery.snapshot("a", delta("first"));
  await settle();
  f.delivery.snapshot("a", delta("superseded"));
  f.delivery.snapshot("a", delta("latest"));
  f.delivery.snapshot("a", delta("parallel", "turn1", 1, "call2"));
  f.delivery.snapshot("b", delta("other"));
  await settle();
  await f.tick();
  assert.deepEqual(f.sent, [
    "a:turn1:0:first",
    "flush",
    "a:turn1:0:latest",
    "flush",
    "a:turn1:1:parallel",
    "flush",
    "b:turn1:0:other",
    "flush",
  ]);
  f.delivery.snapshot("a", delta("old"));
  f.delivery.snapshot("a", delta("new", "turn2"));
  await f.tick();
  assert.equal(f.sent.includes("a:turn1:0:old"), false);
  assert.equal(f.sent.includes("a:turn2:0:new"), true);
});

void it("terminal delivery awaits the session flush before durable supersession without blocking producers", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(() => blocked);
  f.delivery.snapshot("a", delta("first"));
  await settle();
  assert.equal(f.delivery.snapshot("a", delta("final")), undefined);
  assert.equal(
    f.delivery.publish("a", assistant(), async () => {
      f.sent.push("durable");
    }),
    undefined,
  );
  f.delivery.enqueue(async () => {
    f.sent.push("toolCall");
  }, 1);
  f.delivery.snapshot("a", delta("stale"));
  await settle();
  assert.deepEqual(f.sent, ["a:turn1:0:first"]);
  release();
  await settle();
  assert.deepEqual(f.sent, [
    "a:turn1:0:first",
    "flush",
    "a:turn1:0:final",
    "flush",
    "durable",
    "toolCall",
  ]);
  await f.tick();
  assert.equal(
    f.sent.some((value) => value.includes("stale")),
    false,
  );
});

for (const reason of [
  "cancelled",
  "failed",
  "interrupted",
  "completed",
  "head",
  "delete",
  "dispose",
]) {
  void it(`drops pending previews on ${reason}`, async () => {
    const f = fixture();
    f.delivery.snapshot("a", delta("first"));
    await settle();
    f.delivery.snapshot("a", delta("pending"));
    if (reason === "dispose") f.delivery.dispose();
    else if (reason === "delete") {
      f.active.delete("a");
      f.delivery.invalidate("a");
    } else if (reason === "head") f.delivery.invalidate("a");
    else f.delivery.publish("a", transition(reason), async () => {});
    f.delivery.snapshot("a", delta("stale"));
    await f.tick();
    assert.deepEqual(f.sent, ["a:turn1:0:first", "flush"]);
  });
}

void it("retry invalidates old prefixes but accepts a fresh attempt using the same turn and call index", async () => {
  const f = fixture();
  f.delivery.snapshot("a", delta("first"));
  await settle();
  f.delivery.snapshot("a", delta("old"));
  f.delivery.publish("a", transition("retrying"), async () => {
    f.sent.push("retry");
  });
  f.delivery.snapshot("a", delta("fresh"));
  await f.tick();
  assert.deepEqual(f.sent, [
    "a:turn1:0:first",
    "flush",
    "retry",
    "a:turn1:0:fresh",
    "flush",
  ]);
});

void it("keeps append-only text, thinking, and tool-output writes intact and ordered", async () => {
  const f = fixture();
  for (const value of [
    "text1",
    "text2",
    "thinking1",
    "thinking2",
    "stdout1",
    "stdout2",
  ])
    f.delivery.enqueue(async () => {
      f.sent.push(value);
    }, value.length);
  await settle();
  assert.deepEqual(f.sent, [
    "text1",
    "text2",
    "thinking1",
    "thinking2",
    "stdout1",
    "stdout2",
  ]);
});

void it("teardown before the first draft blocks late turns until a new execution starts", async () => {
  const f = fixture();
  f.delivery.publish("a", transition("cancelled"), async () => {});
  f.delivery.snapshot("a", delta("late", "old-turn"));
  await f.tick();
  assert.deepEqual(f.sent, []);
  f.delivery.publish("a", transition("started"), async () => {});
  f.delivery.snapshot("a", delta("fresh", "new-turn"));
  await settle();
  assert.deepEqual(f.sent, ["a:new-turn:0:fresh", "flush"]);
});

void it("durable completion without a preview still retires that turn", async () => {
  const f = fixture();
  f.delivery.publish("a", assistant(), async () => {
    f.sent.push("durable");
  });
  f.delivery.snapshot("a", delta("stale"));
  await f.tick();
  assert.deepEqual(f.sent, ["durable"]);
});
