import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyedSerialQueue } from "./keyed-serial-queue";

describe("KeyedSerialQueue", () => {
  it("orders mutations for one note without blocking another note", async () => {
    const queue = new KeyedSerialQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue("note-a", async () => {
      events.push("a1:start");
      await gate;
      events.push("a1:end");
    });
    const second = queue.enqueue("note-a", async () => {
      events.push("a2");
    });
    const independent = queue.enqueue("note-b", async () => {
      events.push("b1");
    });

    await independent;
    assert.deepEqual(events, ["a1:start", "b1"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["a1:start", "b1", "a1:end", "a2"]);
  });

  it("continues after a failed mutation and exposes a wait barrier", async () => {
    const queue = new KeyedSerialQueue();
    const failed = queue.enqueue("note-a", async () => {
      throw new Error("save failed");
    });
    const next = queue.enqueue("note-a", async () => "renamed");

    await assert.rejects(failed, /save failed/);
    await queue.wait("note-a");
    assert.equal(await next, "renamed");
  });
});
