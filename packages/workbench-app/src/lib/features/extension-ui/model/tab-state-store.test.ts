import assert from "node:assert/strict";
import test from "node:test";
import { bridgeLimits } from "@nervekit/contracts/extensions";
import {
  maxTabStateEntries,
  TabStateStore,
  tabStateKey,
} from "./tab-state-store";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("state persists per key across store instances", () => {
  const storage = memory();
  const key = tabStateKey({
    projectId: "p",
    extensionId: "e",
    kind: "page",
    contributionId: "home",
    instance: "t",
  });
  assert.equal(new TabStateStore(storage).get(key), null);
  assert.equal(new TabStateStore(storage).set(key, { scroll: 4 }), true);
  assert.deepEqual(new TabStateStore(storage).get(key), { scroll: 4 });
});

test("oversized state is refused and the oldest entries drop", () => {
  const store = new TabStateStore(memory());
  assert.equal(
    store.set("big", "x".repeat(bridgeLimits.maxTabStateBytes + 1)),
    false,
  );
  assert.equal(store.get("big"), null);
  for (let index = 0; index <= maxTabStateEntries; index += 1)
    store.set(`k${index}`, index, index);
  assert.equal(store.get("k0"), null);
  assert.equal(store.get(`k${maxTabStateEntries}`), maxTabStateEntries);
});

test("a corrupt store reads as empty", () => {
  const storage = { getItem: () => "{nope", setItem: () => undefined };
  assert.equal(new TabStateStore(storage).get("x"), null);
});
