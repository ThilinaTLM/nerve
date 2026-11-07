import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { sidebarConversations } from "./sidebar-conversation-rows";

const summary = (id: string, extra: object = {}) =>
  ({
    id,
    parentConversationId: null,
    pinnedAt: null,
    references: [],
    pendingInput: null,
    title: id,
    ...extra,
  }) as unknown as ConversationSummary;

test("unchanged summaries keep row identity across list updates", () => {
  const first = sidebarConversations([summary("a"), summary("b")]);
  const second = sidebarConversations([
    summary("a"),
    summary("b", { title: "changed" }),
  ]);
  assert.equal(second[0], first[0]);
  assert.notEqual(second[1], first[1]);
  assert.equal(second[1].title, "changed");
  assert.equal(second[1].activeAgentId, "b");
});

test("a summary patched in place still produces a fresh row", () => {
  const source = summary("c");
  const first = sidebarConversations([source]);
  (source as { title: string }).title = "patched";
  const second = sidebarConversations([source]);
  assert.notEqual(second[0], first[0]);
  assert.equal(second[0].title, "patched");
});
