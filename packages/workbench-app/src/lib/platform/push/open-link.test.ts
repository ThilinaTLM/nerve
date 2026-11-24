import assert from "node:assert/strict";
import test from "node:test";
import {
  OPEN_CONVERSATION_MESSAGE,
  openConversationUrl,
  parseOpenConversationMessage,
  takeOpenLink,
} from "./open-link";

test("takeOpenLink returns the id and a clean URL", () => {
  assert.deepEqual(
    takeOpenLink({ pathname: "/", search: "?open=abc&x=1", hash: "#h" }),
    { conversationId: "abc", cleanUrl: "/?x=1#h" },
  );
  assert.deepEqual(
    takeOpenLink({ pathname: "/", search: "?open=a%20b", hash: "" }),
    { conversationId: "a b", cleanUrl: "/" },
  );
  assert.equal(
    takeOpenLink({ pathname: "/", search: "", hash: "" }),
    undefined,
  );
  assert.equal(
    takeOpenLink({ pathname: "/", search: "?open=", hash: "" }),
    undefined,
  );
});

test("openConversationUrl round-trips through takeOpenLink", () => {
  const url = new URL(openConversationUrl("a/b c"), "https://x.test");
  assert.equal(takeOpenLink(url)?.conversationId, "a/b c");
});

test("parseOpenConversationMessage accepts only the worker message", () => {
  assert.equal(
    parseOpenConversationMessage({
      type: OPEN_CONVERSATION_MESSAGE,
      conversationId: "c",
    }),
    "c",
  );
  assert.equal(parseOpenConversationMessage({ type: "other" }), undefined);
  assert.equal(parseOpenConversationMessage(null), undefined);
  assert.equal(
    parseOpenConversationMessage({ type: OPEN_CONVERSATION_MESSAGE }),
    undefined,
  );
});
