import assert from "node:assert/strict";
import test from "node:test";
import { recoverSnapshotFromNetwork } from "./snapshot-recovery";

test("snapshot recovery bypasses stale cache and applies before caching cursor", async () => {
  const stale = { value: "stale", cursor: 1 };
  const fresh = { value: "fresh", cursor: 7 };
  let cached = stale;
  let requests = 0;
  const order: string[] = [];
  const cursor = await recoverSnapshotFromNetwork({
    fetch: async () => {
      requests += 1;
      order.push("fetch");
      return fresh;
    },
    apply: async (snapshot) => {
      order.push(`apply:${snapshot.value}`);
      return snapshot.cursor;
    },
    cache: (snapshot) => {
      order.push("cache");
      cached = snapshot;
    },
  });
  assert.equal(requests, 1);
  assert.equal(cursor, 7);
  assert.equal(cached, fresh);
  assert.deepEqual(order, ["fetch", "apply:fresh", "cache"]);
});

test("snapshot recovery does not cache before application completes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const recovery = recoverSnapshotFromNetwork({
    fetch: async () => ({ cursor: 3 }),
    apply: async (snapshot) => {
      order.push("apply:start");
      await gate;
      order.push("apply:end");
      return snapshot.cursor;
    },
    cache: () => order.push("cache"),
  });
  await Promise.resolve();
  assert.deepEqual(order, ["apply:start"]);
  release();
  await recovery;
  assert.deepEqual(order, ["apply:start", "apply:end", "cache"]);
});
