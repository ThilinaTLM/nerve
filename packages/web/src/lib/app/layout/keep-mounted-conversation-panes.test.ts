import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { CenterTabIdentity } from "$lib/features/workspace";
import {
  type ConversationPaneTab,
  conversationPaneTabListsEqual,
  renderableConversationPaneTabs,
  updateMountedConversationPaneTabs,
} from "./keep-mounted-conversation-panes";

const conv = (id: string): ConversationPaneTab => ({
  kind: "conversation",
  id,
});
const pending = (id: string): ConversationPaneTab => ({
  kind: "pending-conversation",
  id,
});
const file = (id: string): CenterTabIdentity => ({ kind: "file", id });

describe("keep-mounted conversation panes", () => {
  it("moves the active conversation tab to the front", () => {
    assert.deepEqual(
      updateMountedConversationPaneTabs([conv("a"), conv("b")], conv("b"), [
        conv("a"),
        conv("b"),
      ]),
      [conv("b"), conv("a")],
    );
  });

  it("retains recent conversation panes while a non-conversation tab is active", () => {
    assert.deepEqual(
      updateMountedConversationPaneTabs(
        [conv("b"), conv("a")],
        file("readme"),
        [conv("a"), conv("b"), file("readme")],
      ),
      [conv("b"), conv("a")],
    );
  });

  it("evicts closed panes and enforces the LRU limit", () => {
    assert.deepEqual(
      updateMountedConversationPaneTabs(
        [conv("d"), conv("c"), conv("b"), conv("a")],
        conv("e"),
        [conv("b"), conv("c"), conv("d"), conv("e")],
        3,
      ),
      [conv("e"), conv("d"), conv("c")],
    );
  });

  it("includes pending conversation tabs in the mounted-pane cache", () => {
    assert.deepEqual(
      updateMountedConversationPaneTabs([conv("a")], pending("draft"), [
        conv("a"),
        pending("draft"),
      ]),
      [pending("draft"), conv("a")],
    );
  });

  it("renders a newly active pane immediately before the LRU effect catches up", () => {
    assert.deepEqual(renderableConversationPaneTabs([conv("a")], conv("b")), [
      conv("b"),
      conv("a"),
    ]);
  });

  it("compares pane lists by tab identity", () => {
    assert.equal(
      conversationPaneTabListsEqual(
        [conv("a"), pending("b")],
        [conv("a"), pending("b")],
      ),
      true,
    );
    assert.equal(
      conversationPaneTabListsEqual([conv("a")], [conv("b")]),
      false,
    );
  });
});
