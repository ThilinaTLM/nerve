import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationEventTypes } from "@nervekit/contracts";
import { isSandboxConversationUiEvent } from "./sandbox-conversation-event-routing";

describe("sandbox conversation event routing", () => {
  it("routes the complete shared conversation event contract", () => {
    for (const type of conversationEventTypes) {
      assert.equal(isSandboxConversationUiEvent(type), true, type);
    }
  });

  it("does not route legacy sandbox-only run events", () => {
    for (const type of [
      "run.delta",
      "run.transcript.appended",
      "run.waiting",
      "sandbox.ready",
    ]) {
      assert.equal(isSandboxConversationUiEvent(type), false, type);
    }
  });
});
