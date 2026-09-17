import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCapabilityMutationQueue } from "./capability-mutation-queue.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
};

describe("createCapabilityMutationQueue", () => {
  it("runs mutations in submission order, never concurrently", async () => {
    const queue = createCapabilityMutationQueue();
    const started: string[] = [];
    const first = deferred();

    const a = queue.run(async () => {
      started.push("a");
      await first.promise;
      return "a";
    });
    const b = queue.run(async () => {
      started.push("b");
      return "b";
    });

    await Promise.resolve();
    assert.deepEqual(started, ["a"]);
    first.resolve();
    assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
    assert.deepEqual(started, ["a", "b"]);
  });

  it("keeps draining after a failed mutation", async () => {
    const queue = createCapabilityMutationQueue();
    const failure = queue.run(async () => {
      throw new Error("digest conflict");
    });

    await assert.rejects(failure, /digest conflict/);
    assert.equal(await queue.run(async () => "next"), "next");
    await queue.settled();
  });
});
