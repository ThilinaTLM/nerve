import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryIdempotencyStore } from "../../src/rpc/idempotency-store.js";
import { createFakeClock, settle } from "../support/fake-clock.js";

const outcome = (value: string) => ({ ok: true, result: value }) as never;

describe("MemoryIdempotencyStore", () => {
  it("shares one execution between concurrent duplicates", async () => {
    const store = new MemoryIdempotencyStore();
    let runs = 0;
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const op = async () => {
      runs += 1;
      await gate;
      return outcome("a");
    };
    const first = store.execute("s", "k", "m", { x: 1 }, op);
    await settle();
    const second = store.execute("s", "k", "m", { x: 1 }, op);
    finish();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(runs, 1);
    assert.equal(a.status, "executed");
    assert.equal(b.status, "replayed");
  });

  it("replays completed results until the TTL elapses", async () => {
    const fake = createFakeClock();
    const store = new MemoryIdempotencyStore(100, 10, fake.now);
    let runs = 0;
    const op = async () => outcome(String(++runs));
    await store.execute("s", "k", "m", {}, op);
    await fake.advance(99);
    assert.equal(
      (await store.execute("s", "k", "m", {}, op)).status,
      "replayed",
    );
    await fake.advance(1);
    assert.equal(
      (await store.execute("s", "k", "m", {}, op)).status,
      "executed",
    );
    assert.equal(runs, 2);
  });

  it("rejects the same key with a different method or payload, ignoring key order", async () => {
    const store = new MemoryIdempotencyStore();
    const op = async () => outcome("a");
    await store.execute("s", "k", "m", { a: 1, b: 2 }, op);
    assert.equal(
      (await store.execute("s", "k", "m", { b: 2, a: 1 }, op)).status,
      "replayed",
    );
    assert.equal(
      (await store.execute("s", "k", "m", { a: 2 }, op)).status,
      "conflict",
    );
    assert.equal(
      (await store.execute("s", "k", "other", { a: 1, b: 2 }, op)).status,
      "conflict",
    );
  });

  it("evicts the oldest completed entry beyond capacity and scopes keys", async () => {
    const store = new MemoryIdempotencyStore(1_000, 2, () => 0);
    let runs = 0;
    const op = async () => outcome(String(++runs));
    await store.execute("s", "1", "m", {}, op);
    await store.execute("s", "2", "m", {}, op);
    await store.execute("s", "3", "m", {}, op);
    assert.equal(
      (await store.execute("s", "3", "m", {}, op)).status,
      "replayed",
    );
    assert.equal(
      (await store.execute("s", "1", "m", {}, op)).status,
      "executed",
    );
    assert.equal(
      (await store.execute("other", "3", "m", {}, op)).status,
      "executed",
    );
  });

  it("does not cache a failed operation", async () => {
    const store = new MemoryIdempotencyStore();
    await assert.rejects(
      store.execute("s", "k", "m", {}, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(
      (await store.execute("s", "k", "m", {}, async () => outcome("ok")))
        .status,
      "executed",
    );
  });
});
