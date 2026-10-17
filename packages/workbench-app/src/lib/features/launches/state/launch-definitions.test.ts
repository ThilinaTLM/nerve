import assert from "node:assert/strict";
import { test } from "node:test";
import type { LaunchDefinitionCatalog } from "@nervekit/contracts/launch-definitions";
import { createLaunchCatalogCache } from "./launch-catalog-cache";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const catalog = (
  projectId: string,
  revision: string,
): LaunchDefinitionCatalog => ({
  projectId,
  revision,
  definitions: [],
  folders: [],
});
test("coalesces reads but fences a response predating an invalidation", async () => {
  const requests = [
    deferred<LaunchDefinitionCatalog>(),
    deferred<LaunchDefinitionCatalog>(),
  ];
  let calls = 0;
  const store = createLaunchCatalogCache(() => requests[calls++]!.promise);
  const first = store.load("proj_a");
  const concurrent = store.load("proj_a");
  await Promise.resolve();
  assert.equal(calls, 1);
  const invalidation = store.invalidate("proj_a");
  requests[0]!.resolve(catalog("proj_a", "old"));
  await Promise.resolve();
  assert.equal(store.cached("proj_a"), undefined);
  assert.equal(calls, 2);
  requests[1]!.resolve(catalog("proj_a", "new"));
  await Promise.all([first, concurrent, invalidation]);
  assert.equal(store.cached("proj_a")?.revision, "new");
});
test("isolates projects and retains distinguishable stale data after failure", async () => {
  let fail = false;
  const store = createLaunchCatalogCache(async (projectId) => {
    if (fail && projectId === "proj_a") throw new Error("invalid catalog");
    return catalog(projectId, projectId);
  });
  await Promise.all([store.load("proj_a"), store.load("proj_b")]);
  fail = true;
  await assert.rejects(store.invalidate("proj_a"), /invalid catalog/);
  assert.equal(store.cached("proj_a")?.revision, "proj_a");
  assert.equal(store.error("proj_a"), "invalid catalog");
  assert.equal(store.error("proj_b"), undefined);
  fail = false;
  await store.revalidate();
  assert.equal(store.error("proj_a"), undefined);
});
test("a stale failure cannot overwrite newer invalidation freshness", async () => {
  const old = deferred<LaunchDefinitionCatalog>();
  let calls = 0;
  const store = createLaunchCatalogCache(() =>
    ++calls === 1 ? old.promise : Promise.resolve(catalog("proj_a", "latest")),
  );
  const pending = store.load("proj_a");
  await Promise.resolve();
  void store.invalidate("proj_a");
  old.reject(new Error("stale failure"));
  await pending;
  assert.equal(store.cached("proj_a")?.revision, "latest");
  assert.equal(store.error("proj_a"), undefined);
});

test("invalidation from a snapshot subscriber is awaited before the shared request settles", async () => {
  let calls = 0;
  let invalidation: Promise<void> | undefined;
  const store = createLaunchCatalogCache(
    async () => catalog("proj_a", String(++calls)),
    () => {
      if (calls === 1) invalidation = store.invalidate("proj_a");
    },
  );
  await store.load("proj_a");
  await invalidation;
  assert.equal(calls, 2);
  assert.equal(store.cached("proj_a")?.revision, "2");
});
test("invalidation queued by a subscriber after completion starts a new awaited read", async () => {
  let calls = 0;
  let invalidation: Promise<void> | undefined;
  const store = createLaunchCatalogCache(
    async () => catalog("proj_a", String(++calls)),
    () => {
      if (calls === 1)
        queueMicrotask(() => {
          invalidation = store.invalidate("proj_a");
        });
    },
  );
  await store.load("proj_a");
  await invalidation;
  assert.equal(calls, 2);
  assert.equal(store.cached("proj_a")?.revision, "2");
});
