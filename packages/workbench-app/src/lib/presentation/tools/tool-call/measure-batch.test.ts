import assert from "node:assert/strict";
import test from "node:test";
import { MeasureBatch } from "./measure-batch";

test("runs all reads before any apply, in one frame", () => {
  const frames: Array<() => void> = [];
  const batch = new MeasureBatch({
    request: (cb) => frames.push(cb),
    cancel: () => {},
  });
  const log: string[] = [];
  for (const name of ["a", "b"]) {
    batch.queue(
      { name },
      {
        read: () => (log.push(`read ${name}`), name),
        apply: (value) => log.push(`apply ${value}`),
      },
    );
  }
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(log, ["read a", "read b", "apply a", "apply b"]);
});

test("requeue by owner replaces the pending task; cancel drops it", () => {
  const frames: Array<() => void> = [];
  let cancelled = 0;
  const batch = new MeasureBatch({
    request: (cb) => frames.push(cb),
    cancel: () => {
      cancelled += 1;
    },
  });
  const owner = {};
  const log: string[] = [];
  batch.queue(owner, { read: () => 1, apply: () => log.push("old") });
  batch.queue(owner, { read: () => 2, apply: () => log.push("new") });
  frames[0]();
  assert.deepEqual(log, ["new"]);
  batch.queue(owner, { read: () => 3, apply: () => log.push("x") });
  batch.cancel(owner);
  assert.equal(cancelled, 1);
});
