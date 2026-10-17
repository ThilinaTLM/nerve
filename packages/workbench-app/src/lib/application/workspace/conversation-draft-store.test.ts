import assert from "node:assert/strict";
import test from "node:test";
import { PersistentConversationDraftStore } from "./conversation-draft-store";

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
  const store = new PersistentConversationDraftStore(storage);
  const text = `${"A long answer\n".repeat(1000)}END`;
  store.update("call-a", "q1", { text, option: "Yes" });
  store.update("call-a", "q2", { text: "second" });
  store.update("call-b", "q1", { option: "No" });
  store.update("call-a", "q1", { option: undefined });
  assert.deepEqual(store.get("call-a"), {
    q1: { text, option: undefined },
    q2: { text: "second" },
  });
  const restored = new PersistentConversationDraftStore(storage);
  assert.deepEqual(restored.get("call-a"), {
    q1: { text },
    q2: { text: "second" },
  });
  assert.deepEqual(restored.get("call-b"), { q1: { option: "No" } });
  restored.clear("call-a");
  assert.deepEqual(
    new PersistentConversationDraftStore(storage).get("call-a"),
    {},
  );
  assert.deepEqual(restored.get("call-b"), { q1: { option: "No" } });
});

test("bounds storage to the newest 50 tool calls, including on load", () => {
  const storage = fakeStorage();
  const saved = Object.fromEntries(
    Array.from({ length: 55 }, (_, i) => [
      `ask-user:call-${i}`,
      { kind: "ask-user", updatedAt: i, questions: { q: { text: `${i}` } } },
    ]),
  );
  storage.setItem("nerve:conversation-drafts:v1", JSON.stringify(saved));
  const store = new PersistentConversationDraftStore(storage);
  assert.equal(
    Object.keys(JSON.parse(storage.getItem("nerve:conversation-drafts:v1")!))
      .length,
    50,
  );
  assert.deepEqual(store.get("call-0"), {});
  assert.deepEqual(store.get("call-4"), {});
  assert.deepEqual(store.get("call-5"), { q: { text: "5" } });
  store.update("new", "q", { text: "newest" });
  const restored = new PersistentConversationDraftStore(storage);
  assert.deepEqual(restored.get("call-5"), {});
  assert.deepEqual(restored.get("new"), { q: { text: "newest" } });
});

test("invalid JSON, malformed entries, denied storage and write failures are safe", () => {
  const storage = fakeStorage();
  storage.setItem("nerve:conversation-drafts:v1", "{broken");
  assert.deepEqual(new PersistentConversationDraftStore(storage).get("x"), {});
  storage.setItem(
    "nerve:conversation-drafts:v1",
    JSON.stringify({
      "ask-user:bad": {
        kind: "ask-user",
        questions: { q: { text: "invalid timestamp" } },
      },
      "conversation:valid": {
        kind: "prompt",
        updatedAt: 1,
        target: { kind: "conversation", id: "valid" },
        text: "kept prompt",
      },
      "conversation:mismatch": {
        kind: "prompt",
        updatedAt: 1,
        target: { kind: "conversation", id: "wrong" },
        text: "not kept",
      },
      "pending-conversation:invalid": {
        kind: "prompt",
        updatedAt: 1,
        target: { kind: "pending-conversation", id: "invalid", projectId: 123 },
        text: "not kept",
      },
      "ask-user:good": {
        kind: "ask-user",
        updatedAt: 1,
        questions: { q: { text: "kept", option: 123 }, invalid: null },
      },
    }),
  );
  assert.deepEqual(new PersistentConversationDraftStore(storage).get("good"), {
    q: { text: "kept" },
  });
  const parsed = new PersistentConversationDraftStore(storage);
  assert.equal(
    parsed.getPrompt({ kind: "conversation", id: "valid" }),
    "kept prompt",
  );
  assert.equal(parsed.getPrompt({ kind: "conversation", id: "wrong" }), "");
  assert.equal(
    parsed.getPrompt({
      kind: "pending-conversation",
      id: "invalid",
      projectId: "project",
    }),
    "",
  );
  const denied = new PersistentConversationDraftStore({
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
  const target = { kind: "conversation" as const, id: "denied" };
  denied.setPrompt(target, "prompt in memory");
  assert.equal(denied.getPrompt(target), "prompt in memory");
  denied.clearPrompt(target);
  assert.equal(denied.getPrompt(target), "");
});

test("prompt drafts persist by conversation independently of pending and ask_user namespaces", () => {
  const storage = fakeStorage();
  const store = new PersistentConversationDraftStore(storage);
  const first = { kind: "conversation" as const, id: "same-id" };
  const second = { kind: "conversation" as const, id: "other" };
  const pending = {
    kind: "pending-conversation" as const,
    id: "same-id",
    projectId: "project",
  };
  const text = `  unsent\n${"long text\n".repeat(1000)}END  `;
  store.setPrompt(first, text);
  store.setPrompt(second, "another draft");
  store.setPrompt(pending, "pending text");
  store.update("same-id", "q", { text: "answer" });
  const restored = new PersistentConversationDraftStore(storage);
  assert.equal(restored.getPrompt(first), text);
  assert.equal(restored.getPrompt(second), "another draft");
  assert.equal(restored.getPrompt(pending), "pending text");
  assert.deepEqual(restored.get("same-id"), { q: { text: "answer" } });
  // Conversation deletion removes only its prompt, durably.
  restored.clearPrompt(first);
  const afterDeletion = new PersistentConversationDraftStore(storage);
  assert.equal(afterDeletion.getPrompt(first), "");
  assert.equal(afterDeletion.getPrompt(second), "another draft");
  assert.equal(afterDeletion.getPrompt(pending), "pending text");
  assert.deepEqual(afterDeletion.get("same-id"), { q: { text: "answer" } });
});

test("successful sends clear only unchanged text in the captured conversation", () => {
  const storage = fakeStorage();
  const store = new PersistentConversationDraftStore(storage);
  const target = { kind: "conversation" as const, id: "a" };
  const other = { kind: "conversation" as const, id: "b" };
  store.setPrompt(target, "sent text");
  store.setPrompt(other, "other text");
  store.setPrompt(target, "typed while sending");
  store.clearPromptIfUnchanged(target, "sent text");
  assert.equal(store.getPrompt(target), "typed while sending");
  store.clearPromptIfUnchanged(target, "typed while sending");
  assert.equal(
    new PersistentConversationDraftStore(storage).getPrompt(target),
    "",
  );
  assert.equal(store.getPrompt(other), "other text");
  store.setPrompt(other, "");
  assert.equal(
    new PersistentConversationDraftStore(storage).getPrompt(other),
    "",
  );
});

test("pending-to-created handoff migrates the latest unsent text and removes the pending entry", () => {
  const storage = fakeStorage();
  const pending = {
    kind: "pending-conversation" as const,
    id: "p",
    projectId: "project",
  };
  const created = { kind: "conversation" as const, id: "created" };
  const store = new PersistentConversationDraftStore(storage);
  store.setPrompt(pending, "first send");
  store.setPrompt(pending, "typed while sending");
  store.clearPromptIfUnchanged(pending, "first send");
  store.promotePendingPrompt(pending.id, created.id);
  const restored = new PersistentConversationDraftStore(storage);
  assert.equal(restored.getPrompt(pending), "");
  assert.equal(restored.getPrompt(created), "typed while sending");
  assert.equal(restored.restorablePendingPrompt("project", []), undefined);
  // An unchanged successful first send has nothing left to hand off.
  restored.setPrompt(pending, "first send");
  restored.clearPromptIfUnchanged(pending, "first send");
  restored.promotePendingPrompt(pending.id, "another-created");
  assert.equal(
    restored.getPrompt({ kind: "conversation", id: "another-created" }),
    "",
  );
  // Sending a suggestion (without clearing) retains the existing draft.
  restored.setPrompt(pending, "keep this draft");
  restored.promotePendingPrompt(pending.id, "suggestion-created");
  assert.equal(
    new PersistentConversationDraftStore(storage).getPrompt({
      kind: "conversation",
      id: "suggestion-created",
    }),
    "keep this draft",
  );
});

test("new pending tabs recover the newest closed/reloaded draft for their project without aliasing open tabs", () => {
  const storage = fakeStorage();
  const store = new PersistentConversationDraftStore(storage);
  const first = {
    kind: "pending-conversation" as const,
    id: "first",
    projectId: "project",
  };
  const second = {
    kind: "pending-conversation" as const,
    id: "second",
    projectId: "project",
  };
  store.setPrompt(first, "first draft");
  store.setPrompt(second, "second draft");
  store.setPrompt(
    { kind: "pending-conversation", id: "unrelated", projectId: "elsewhere" },
    "other project",
  );
  const restored = new PersistentConversationDraftStore(storage);
  assert.deepEqual(restored.restorablePendingPrompt("project", []), second);
  assert.deepEqual(
    restored.restorablePendingPrompt("project", [second.id]),
    first,
  );
  assert.equal(
    restored.restorablePendingPrompt("project", [first.id, second.id]),
    undefined,
  );
  restored.setPrompt(second, "");
  assert.deepEqual(restored.restorablePendingPrompt("project", []), first);
});

test("the oldest-first bound applies across prompt and ask_user entries", () => {
  const storage = fakeStorage();
  const store = new PersistentConversationDraftStore(storage);
  store.update("oldest", "q", { text: "old answer" });
  store.setPrompt({ kind: "conversation", id: "old-prompt" }, "old prompt");
  for (let i = 0; i < 50; i++)
    store.setPrompt({ kind: "conversation", id: `${i}` }, `draft ${i}`);
  const restored = new PersistentConversationDraftStore(storage);
  assert.deepEqual(restored.get("oldest"), {});
  assert.equal(
    restored.getPrompt({ kind: "conversation", id: "old-prompt" }),
    "",
  );
  assert.equal(
    restored.getPrompt({ kind: "conversation", id: "0" }),
    "draft 0",
  );
  assert.equal(
    restored.getPrompt({ kind: "conversation", id: "49" }),
    "draft 49",
  );
});
