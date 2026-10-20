import assert from "node:assert/strict";
import test from "node:test";
import {
  idleConversationActivity,
  type ConversationActivity,
} from "./conversation-activity";
import {
  conversationNeedsAttention,
  conversationRowDetail,
  conversationRowGlyph,
} from "./conversation-row-state";

const needsUser: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "needs-user",
  tone: "warning",
  needsUser: true,
  label: "Needs your attention",
};
const running: ConversationActivity = {
  ...idleConversationActivity,
  indicator: "running",
  tone: "info",
  label: "Agent running",
};

test("glyph is empty only for idle closed conversations", () => {
  assert.equal(conversationRowGlyph(idleConversationActivity, false), "none");
  assert.equal(
    conversationRowGlyph(idleConversationActivity, true),
    "open-dot",
  );
  assert.equal(conversationRowGlyph(running, false), "activity");
});

test("detail line is limited to needs-user and error", () => {
  assert.deepEqual(conversationRowDetail(needsUser), {
    text: "Needs your attention",
    tone: "warning",
  });
  assert.equal(conversationRowDetail(running), undefined);
  assert.equal(conversationNeedsAttention(running), false);
  assert.equal(
    conversationNeedsAttention({ ...running, indicator: "error" }),
    true,
  );
});
