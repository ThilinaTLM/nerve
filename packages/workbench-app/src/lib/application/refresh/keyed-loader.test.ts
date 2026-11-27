import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyedLoader } from "./keyed-loader";

function deferredLoads() {
  const calls: {
    key: string;
    resolve(value: number): void;
    reject(error: Error): void;
  }[] = [];
  const load = (key: string) =>
    new Promise<number>((resolve, reject) => {
      calls.push({ key, resolve, reject });
    });
  return { calls, load };
}

test("ensure shares one request per key and then serves the cache", async () => {
  const { calls, load } = deferredLoads();
  const loader = new KeyedLoader({ load });
  const first = loader.ensure("a");
  const second = loader.ensure("a");
  void loader.ensure("b");
  assert.deepEqual(
    calls.map((call) => call.key),
    ["a", "b"],
  );
  assert.equal(loader.loading("a"), true);
  calls[0].resolve(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(loader.loading("a"), false);
  assert.equal(await loader.ensure("a"), 1);
  assert.equal(calls.length, 2);
});

test("refresh supersedes a running request; the older answer is dropped", async () => {
  const { calls, load } = deferredLoads();
  const loader = new KeyedLoader({ load });
  const first = loader.ensure("a");
  const second = loader.refresh("a");
  // A caller arriving now joins the newest request.
  const joined = loader.ensure("a");
  assert.equal(calls.length, 2);
  calls[1].resolve(2);
  calls[0].resolve(1);
  assert.deepEqual(await Promise.all([first, second, joined]), [2, 2, 2]);
  assert.equal(loader.get("a"), 2);
});

test("errors keep the cached value unless the hook drops it, and only the newest request reports", async () => {
  const { calls, load } = deferredLoads();
  const errors: string[] = [];
  const loader = new KeyedLoader({
    load,
    onError: (key, error) => errors.push(`${key}:${(error as Error).message}`),
  });
  const initial = loader.ensure("a");
  calls[0].resolve(1);
  await initial;
  const stale = loader.refresh("a");
  const latest = loader.refresh("a");
  calls[1].reject(new Error("old"));
  calls[2].reject(new Error("new"));
  await Promise.all([stale, latest]);
  assert.deepEqual(errors, ["a:new"]);
  assert.equal(loader.get("a"), 1);
  assert.equal(loader.loading("a"), false);
  assert.deepEqual(loader.keys(), ["a"]);
});
