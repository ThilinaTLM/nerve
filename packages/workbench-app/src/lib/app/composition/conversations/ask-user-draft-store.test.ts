import assert from "node:assert/strict";
import test from "node:test";
import { PersistentAskUserDraftStore } from "./ask-user-draft-store";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("isolates tool calls and questions and persists text and selected options synchronously", () => {
  const storage = fakeStorage();
  const store = new PersistentAskUserDraftStore(storage);
  const text = `${"A long answer\n".repeat(1000)}END`;
  store.update("call-a", "q1", { text, option: "Yes" });
  store.update("call-a", "q2", { text: "second" });
  store.update("call-b", "q1", { option: "No" });
  store.update("call-a", "q1", { option: undefined });
  assert.deepEqual(store.get("call-a"), {
    q1: { text, option: undefined },
    q2: { text: "second" },
  });
  const restored = new PersistentAskUserDraftStore(storage);
  assert.deepEqual(restored.get("call-a"), {
    q1: { text },
    q2: { text: "second" },
  });
  assert.deepEqual(restored.get("call-b"), { q1: { option: "No" } });
  restored.clear("call-a");
  assert.deepEqual(new PersistentAskUserDraftStore(storage).get("call-a"), {});
  assert.deepEqual(restored.get("call-b"), { q1: { option: "No" } });
});

test("bounds storage to the newest 50 tool calls, including on load", () => {
  const storage = fakeStorage();
  const saved = Object.fromEntries(
    Array.from({ length: 55 }, (_, i) => [
      `call-${i}`,
      { updatedAt: i, questions: { q: { text: `${i}` } } },
    ]),
  );
  storage.setItem("nerve:ask-user-drafts:v1", JSON.stringify(saved));
  const store = new PersistentAskUserDraftStore(storage);
  assert.deepEqual(store.get("call-0"), {});
  assert.deepEqual(store.get("call-4"), {});
  assert.deepEqual(store.get("call-5"), { q: { text: "5" } });
  store.update("new", "q", { text: "newest" });
  const restored = new PersistentAskUserDraftStore(storage);
  assert.deepEqual(restored.get("call-5"), {});
  assert.deepEqual(restored.get("new"), { q: { text: "newest" } });
});

test("invalid JSON, malformed entries, denied storage and write failures are safe", () => {
  const storage = fakeStorage();
  storage.setItem("nerve:ask-user-drafts:v1", "{broken");
  assert.deepEqual(new PersistentAskUserDraftStore(storage).get("x"), {});
  storage.setItem(
    "nerve:ask-user-drafts:v1",
    JSON.stringify({
      bad: { questions: { q: { text: "invalid timestamp" } } },
      good: {
        updatedAt: 1,
        questions: { q: { text: "kept", option: 123 }, invalid: null },
      },
    }),
  );
  assert.deepEqual(new PersistentAskUserDraftStore(storage).get("good"), {
    q: { text: "kept" },
  });
  const denied = new PersistentAskUserDraftStore({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  });
  denied.update("call", "q", { text: "still in memory" });
  assert.deepEqual(denied.get("call"), { q: { text: "still in memory" } });
  denied.clear("call");
  assert.deepEqual(denied.get("call"), {});
});
