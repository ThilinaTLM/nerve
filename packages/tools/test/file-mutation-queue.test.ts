import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pendingFileMutationQueueCount,
  withFileMutationQueue,
} from "../src/execution/filesystem/file-mutation-queue.js";

describe("file mutation queue", () => {
  it("serializes mutations and removes settled queue entries", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withFileMutationQueue("/tmp/file", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = withFileMutationQueue("/tmp/file", async () => {
      order.push("second");
    });
    await Promise.resolve();
    assert.equal(pendingFileMutationQueueCount(), 1);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    assert.equal(pendingFileMutationQueueCount(), 0);
  });

  it("cleans up after a failed mutation", async () => {
    await assert.rejects(
      withFileMutationQueue("/tmp/failing", async () => {
        throw new Error("failure");
      }),
      /failure/,
    );
    assert.equal(pendingFileMutationQueueCount(), 0);
  });
});
