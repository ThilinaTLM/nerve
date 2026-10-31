import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_TITLE_IMAGE_MARKER as IMAGE,
  conversationTitleToPlainText,
  splitConversationTitle,
} from "../../src/domains/core/conversation-title.js";

test("image title segments and plain-text fallback", () => {
  assert.deepEqual(splitConversationTitle(`Review ${IMAGE} now`), [
    { type: "text", text: "Review " },
    { type: "image" },
    { type: "text", text: " now" },
  ]);
  assert.equal(
    conversationTitleToPlainText(`Review ${IMAGE}`),
    "Review (image)",
  );
});
test("ordinary manual titles stay untouched", () => {
  const title = "Review @image.png (image) [image]";
  assert.equal(conversationTitleToPlainText(title), title);
  assert.deepEqual(splitConversationTitle(title), [
    { type: "text", text: title },
  ]);
});
