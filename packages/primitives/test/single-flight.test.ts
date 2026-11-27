import assert from "node:assert/strict";
import { test } from "node:test";
import { singleFlight } from "../src/index.ts";

test("concurrent callers share one call, which is cleared on settle", async () => {
  const inflight = new Map<string, Promise<number>>();
  let calls = 0;
  let release!: (value: number) => void;
  const fn = () => {
    calls += 1;
    return new Promise<number>((resolve) => (release = resolve));
  };
  const a = singleFlight(inflight, "k", fn);
  const b = singleFlight(inflight, "k", fn);
  assert.equal(a, b);
  assert.equal(inflight.size, 1);
  release(7);
  assert.equal(await a, 7);
  assert.equal(inflight.size, 0);
  const c = singleFlight(inflight, "k", async () => 8);
  assert.equal(await c, 8);
  assert.equal(calls, 1);
});

test("failures are shared, then cleared so the next call retries", async () => {
  const inflight = new Map<string, Promise<number>>();
  const failing = singleFlight(inflight, "k", () =>
    Promise.reject(new Error("bad")),
  );
  await assert.rejects(failing, /bad/);
  assert.equal(inflight.size, 0);
  assert.equal(await singleFlight(inflight, "k", async () => 1), 1);
});

test("a synchronous throw rejects and is not stored", async () => {
  const inflight = new Map<string, Promise<number>>();
  await assert.rejects(
    singleFlight(inflight, "k", () => {
      throw new Error("sync");
    }),
    /sync/,
  );
  assert.equal(inflight.size, 0);
});

test("different keys do not share", async () => {
  const inflight = new Map<string, Promise<string>>();
  const [a, b] = await Promise.all([
    singleFlight(inflight, "a", async () => "a"),
    singleFlight(inflight, "b", async () => "b"),
  ]);
  assert.deepEqual([a, b], ["a", "b"]);
});
