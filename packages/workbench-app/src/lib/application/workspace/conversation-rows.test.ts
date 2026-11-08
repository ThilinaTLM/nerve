import assert from "node:assert/strict";
import { test } from "node:test";
import { withConversationRow } from "./conversation-rows";

test("appends a conversation row when its id is missing", () => {
  const rows = [{ id: "a", title: "A" }];
  assert.deepEqual(withConversationRow(rows, { id: "b", title: "B" }), [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ]);
});

test("keeps the existing row instead of adding a stale duplicate", () => {
  const rows = [{ id: "a", title: "Derived title" }];
  const result = withConversationRow(rows, {
    id: "a",
    title: "New Conversation",
  });
  assert.equal(result, rows);
  assert.deepEqual(result, [{ id: "a", title: "Derived title" }]);
});
