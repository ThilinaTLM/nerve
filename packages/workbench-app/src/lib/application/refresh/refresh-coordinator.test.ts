import assert from "node:assert/strict";
import { test } from "node:test";
import { RefreshCoordinator } from "./refresh-coordinator";

test("merges pending demand and runs one trailing refresh", async () => {
  const runs: number[] = [];
  let release: (() => void) | undefined;
  const firstRun = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new RefreshCoordinator<number>({
    merge: (current, next) => Math.max(current ?? 0, next),
    execute: async (demand) => {
      runs.push(demand);
      if (runs.length === 1) await firstRun;
    },
  });

  const first = coordinator.request(1);
  const second = coordinator.request(2);
  const third = coordinator.request(3);
  assert.deepEqual(runs, [1]);
  release?.();
  await Promise.all([first, second, third]);
  assert.deepEqual(runs, [1, 3]);
  coordinator.stop();
});
