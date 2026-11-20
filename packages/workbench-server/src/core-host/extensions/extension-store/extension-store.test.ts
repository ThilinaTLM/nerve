import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bridgeLimits } from "@nervekit/contracts/extensions";
import {
  ExtensionStore,
  ExtensionStoreError,
  type ExtensionStoreChange,
} from "./extension-store.js";

let home = "";
let counter = 0;
before(async () => {
  home = await mkdtemp(join(tmpdir(), "extension-store-"));
});
after(async () => {
  await rm(home, { recursive: true, force: true });
});

function setup() {
  const root = join(home, `s${counter++}`);
  const changes: ExtensionStoreChange[] = [];
  const store = new ExtensionStore({
    root,
    projectExists: (id) => id === "p1" || id === "p2",
    onChange: (change) => void changes.push(change),
  });
  return { root, store, changes };
}

const scope = { extensionId: "demo", projectId: "p1" };
const fails = (promise: Promise<unknown>, code: string) =>
  assert.rejects(
    promise,
    (error) => error instanceof ExtensionStoreError && error.code === code,
  );

void test("revisions count up from 1 and ifRevision 0 means the key must not exist", async () => {
  const { store } = setup();
  assert.equal(await store.get(scope, "a"), undefined);
  assert.deepEqual(await store.set(scope, "a", { n: 1 }, { ifRevision: 0 }), {
    revision: 1,
  });
  await fails(store.set(scope, "a", 2, { ifRevision: 0 }), "conflict");
  await fails(store.set(scope, "a", 2, { ifRevision: 5 }), "conflict");
  assert.deepEqual(await store.set(scope, "a", [2], { ifRevision: 1 }), {
    revision: 2,
  });
  assert.deepEqual(await store.get(scope, "a"), { value: [2], revision: 2 });
  await fails(store.delete(scope, "a", { ifRevision: 1 }), "conflict");
  await store.delete(scope, "a", { ifRevision: 2 });
  assert.equal(await store.get(scope, "a"), undefined);
  // A deleted key starts over; deleting a missing key succeeds (and only "must not exist" is true of it).
  assert.deepEqual(await store.set(scope, "a", null), { revision: 1 });
  await store.delete(scope, "gone");
  await fails(store.delete(scope, "gone", { ifRevision: 1 }), "conflict");
  await store.delete(scope, "gone", { ifRevision: 0 });
});

void test("keys are sorted, filtered by prefix and scoped to extension and project", async () => {
  const { store } = setup();
  await store.set(scope, "b.2", "x");
  await store.set(scope, "b.1", "yy");
  await store.set(scope, "c", 1);
  await store.set({ ...scope, projectId: "p2" }, "b.9", 1);
  await store.set({ ...scope, extensionId: "other" }, "b.8", 1);
  assert.deepEqual(await store.keys(scope, "b."), [
    { key: "b.1", revision: 1, size: 4 },
    { key: "b.2", revision: 1, size: 3 },
  ]);
  assert.equal((await store.keys(scope)).length, 3);
});

void test("keys and ids that could leave the folder are refused", async () => {
  const { store, root } = setup();
  for (const key of ["../x", "a/b", ".hidden", "", "a b", "x".repeat(129)])
    await fails(store.set(scope, key, 1), "invalid_request");
  await fails(store.get(scope, "../x"), "invalid_request");
  await fails(
    store.set({ ...scope, extensionId: "../x" }, "a", 1),
    "invalid_request",
  );
  await fails(
    store.set({ ...scope, projectId: "../p1" }, "a", 1),
    "invalid_request",
  );
  await fails(store.set({ ...scope, projectId: "nope" }, "a", 1), "not_found");
  await assert.rejects(readdir(root), { code: "ENOENT" });
});

void test("values must be JSON and within the limits", async () => {
  const { store } = setup();
  await fails(store.set(scope, "a", undefined), "invalid_request");
  await fails(
    store.set(scope, "a", () => 1),
    "invalid_request",
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await fails(store.set(scope, "a", cyclic), "invalid_request");
  await fails(
    store.set(scope, "a", "x".repeat(bridgeLimits.maxStoreValueBytes)),
    "too_large",
  );
  assert.equal((await store.keys(scope)).length, 0);
});

void test("the key count and the total size of a project are capped", async () => {
  const keyCap = setup();
  const dir = join(keyCap.root, "demo", "p1");
  await mkdir(dir, { recursive: true });
  for (let index = 0; index < bridgeLimits.maxStoreKeys; index++)
    await writeFile(join(dir, `k${index}.json`), '{"revision":1,"value":0}');
  await fails(keyCap.store.set(scope, "one-more", 1), "too_large");
  // An existing key can still change.
  assert.deepEqual(await keyCap.store.set(scope, "k0", 2), { revision: 2 });

  const sizeCap = setup();
  const big = "x".repeat(bridgeLimits.maxStoreValueBytes - 100);
  const writes = Math.floor(
    bridgeLimits.maxStoreBytesPerProject / bridgeLimits.maxStoreValueBytes,
  );
  for (let index = 0; index < writes; index++)
    await sizeCap.store.set(scope, `big${index}`, big);
  await fails(sizeCap.store.set(scope, "more", big), "too_large");
  // Replacing a key counts the new value, not the old one.
  await sizeCap.store.set(scope, "big0", big);
});

void test("concurrent writes with the same ifRevision let exactly one win", async () => {
  const { store, root } = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      store.set(scope, "k", index, { ifRevision: 0 }),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal((await store.get(scope, "k"))!.revision, 1);
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => store.set(scope, "n", index)),
  );
  assert.equal((await store.get(scope, "n"))!.revision, 10);
  // No temporary files are left behind.
  assert.deepEqual((await readdir(join(root, "demo", "p1"))).sort(), [
    "k.json",
    "n.json",
  ]);
});

void test("writes publish the new revision, deletes null, with the origin when given", async () => {
  const { store, changes } = setup();
  await store.set(scope, "a", 1, { origin: "f1" });
  await store.set(scope, "a", 2);
  await fails(store.set(scope, "a", 3, { ifRevision: 1 }), "conflict");
  await store.delete(scope, "a", { origin: "f2" });
  await store.delete(scope, "a");
  assert.deepEqual(changes, [
    { ...scope, key: "a", revision: 1, origin: "f1" },
    { ...scope, key: "a", revision: 2 },
    { ...scope, key: "a", revision: null, origin: "f2" },
  ]);
});

void test("forProject binds the project and publishes without an origin", async () => {
  const { store, changes } = setup();
  const port = store.forProject("p1");
  assert.deepEqual(await port.set("demo", "a", { v: 1 }, 0), { revision: 1 });
  assert.deepEqual(await port.get("demo", "a"), {
    value: { v: 1 },
    revision: 1,
  });
  assert.deepEqual(changes, [{ ...scope, key: "a", revision: 1 }]);
  assert.equal(await store.get({ ...scope, projectId: "p2" }, "a"), undefined);
});

void test("deleteProject removes that project's data for every extension", async () => {
  const { store } = setup();
  await store.set(scope, "a", 1);
  await store.set({ ...scope, extensionId: "other" }, "a", 1);
  await store.set({ ...scope, projectId: "p2" }, "a", 1);
  await store.deleteProject("p1");
  assert.equal(await store.get(scope, "a"), undefined);
  assert.equal(
    (await store.get({ ...scope, projectId: "p2" }, "a"))?.revision,
    1,
  );
  await store.deleteProject("../x");
});
