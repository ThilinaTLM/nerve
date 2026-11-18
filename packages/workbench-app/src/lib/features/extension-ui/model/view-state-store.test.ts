import assert from "node:assert/strict";
import test from "node:test";
import { bridgeLimits } from "@nervekit/contracts/extensions";
import {
  maxViewStateEntries,
  ViewStateStore,
  viewStateKey,
} from "./view-state-store";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("state persists per key across store instances", () => {
  const storage = memory();
  const key = viewStateKey({
    projectId: "p",
    extensionId: "e",
    kind: "page",
    contributionId: "home",
    instance: "t",
  });
  assert.equal(new ViewStateStore(storage).get(key), null);
  assert.equal(new ViewStateStore(storage).set(key, { scroll: 4 }), true);
  assert.deepEqual(new ViewStateStore(storage).get(key), { scroll: 4 });
});

test("oversized state is refused and the oldest entries drop", () => {
  const store = new ViewStateStore(memory());
  assert.equal(
    store.set("big", "x".repeat(bridgeLimits.maxViewStateBytes + 1)),
    false,
  );
  assert.equal(store.get("big"), null);
  for (let index = 0; index <= maxViewStateEntries; index += 1)
    store.set(`k${index}`, index, index);
  assert.equal(store.get("k0"), null);
  assert.equal(store.get(`k${maxViewStateEntries}`), maxViewStateEntries);
});

test("a corrupt store reads as empty", () => {
  const storage = { getItem: () => "{nope", setItem: () => undefined };
  assert.equal(new ViewStateStore(storage).get("x"), null);
});
