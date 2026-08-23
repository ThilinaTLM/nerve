import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConversationListPreferences } from "./conversation-list-preferences";

function storage(value: string | null): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: () => value,
    setItem: () => undefined,
  };
}

describe("conversation list preferences", () => {
  it("shows completed conversations by default", () => {
    assert.deepEqual(loadConversationListPreferences(storage(null)), {
      hideCompleted: false,
    });
    assert.deepEqual(loadConversationListPreferences(storage("not-json")), {
      hideCompleted: false,
    });
  });

  it("restores a persisted hide-completed preference", () => {
    assert.deepEqual(
      loadConversationListPreferences(
        storage(JSON.stringify({ hideCompleted: true })),
      ),
      { hideCompleted: true },
    );
    assert.deepEqual(
      loadConversationListPreferences(
        storage(JSON.stringify({ hideCompleted: false })),
      ),
      { hideCompleted: false },
    );
  });
});
