import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHighlightQueue } from "./highlight-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const scheduled: Array<() => void> = [];
  const loads: string[] = [];
  const requests = new Map<
    string,
    ReturnType<typeof deferred<string | undefined>>
  >();
  const cached = new Map<string, string>();
  const queue = createHighlightQueue<string>({
    load: (key) => {
      loads.push(key);
      const request = deferred<string | undefined>();
      requests.set(key, request);
      return request.promise;
    },
    schedule: (start) => scheduled.push(start),
    lookup: (key) => ({ hit: cached.has(key), value: cached.get(key) }),
    store: (key, value) => cached.set(key, value),
  });
  return { queue, scheduled, loads, requests, cached };
}

describe("highlight queue", () => {
  it("shares identical pending work and a resolved cache entry", async () => {
    const state = fixture();
    const first = state.queue.acquire("typescript\0code");
    const second = state.queue.acquire("typescript\0code");

    assert.equal(first.result, second.result);
    assert.equal(state.scheduled.length, 1);
    state.scheduled.shift()?.();
    assert.deepEqual(state.loads, ["typescript\0code"]);
    state.requests.get("typescript\0code")?.resolve("<pre>code</pre>");
    assert.equal(await first.result, "<pre>code</pre>");
    assert.equal(await second.result, "<pre>code</pre>");
    assert.equal(
      state.queue.acquire("typescript\0code").result,
      "<pre>code</pre>",
    );
  });

  it("cancels queued work only after its final lease releases", async () => {
    const state = fixture();
    const first = state.queue.acquire("one");
    const second = state.queue.acquire("one");

    first.release();
    state.scheduled.shift()?.();
    assert.deepEqual(state.loads, ["one"]);
    state.requests.get("one")?.resolve("done");
    assert.equal(await second.result, "done");

    const cancelled = state.queue.acquire("two");
    cancelled.release();
    assert.equal(await cancelled.result, undefined);
    state.scheduled.shift()?.();
    assert.deepEqual(state.loads, ["one"]);
  });

  it("runs one job at a time", async () => {
    const state = fixture();
    const first = state.queue.acquire("one");
    const second = state.queue.acquire("two");

    assert.equal(state.scheduled.length, 1);
    state.scheduled.shift()?.();
    assert.deepEqual(state.loads, ["one"]);
    assert.equal(state.scheduled.length, 0);
    state.requests.get("one")?.resolve("first");
    await first.result;
    assert.equal(state.scheduled.length, 1);
    state.scheduled.shift()?.();
    assert.deepEqual(state.loads, ["one", "two"]);
    state.requests.get("two")?.resolve("second");
    assert.equal(await second.result, "second");
  });

  it("does not cache failures and permits retry", async () => {
    const state = fixture();
    const first = state.queue.acquire("one");
    state.scheduled.shift()?.();
    state.requests.get("one")?.reject(new Error("failed"));
    assert.equal(await first.result, undefined);

    const second = state.queue.acquire("one");
    assert.equal(state.scheduled.length, 1);
    state.scheduled.shift()?.();
    state.requests.get("one")?.resolve("recovered");
    assert.equal(await second.result, "recovered");
  });
});
