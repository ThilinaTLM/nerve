import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationEventTypes,
  type EventEnvelope,
} from "@nervekit/contracts";
import {
  conversationIdFromEvent,
  isConversationStreamEvent,
} from "./conversation-event-routing";

const base = {
  id: "evt_1",
  seq: 1,
  ts: "2026-01-01T00:00:00.000Z",
};

function event(
  type: string,
  data: Record<string, unknown> = { conversationId: "conv_a" },
): EventEnvelope<Record<string, unknown>> {
  return { ...base, type, data };
}

describe("conversation event routing", () => {
  it("routes every contract conversation projection event by its catalog stream", () => {
    for (const type of conversationEventTypes) {
      assert.equal(
        isConversationStreamEvent(event(type)),
        true,
        `unexpected routing for '${type}'`,
      );
    }
  });

  it("also routes render-neutral events that occupy conversation sequence numbers", () => {
    for (const type of ["run.checkpointed", "policy.evaluated"]) {
      assert.equal(isConversationStreamEvent(event(type)), true, type);
    }
  });

  it("does not treat workspace conversation events as conversation-stream events", () => {
    assert.equal(
      isConversationStreamEvent(event("conversation.deleted")),
      false,
    );
    assert.equal(
      isConversationStreamEvent(
        event("agent.configured", {
          agent: { conversationId: "conv_a" },
        }),
      ),
      false,
    );
  });

  it("extracts the conversation id from event payload shapes", () => {
    assert.equal(conversationIdFromEvent(event("run.started")), "conv_a");
    assert.equal(
      conversationIdFromEvent(
        event("conversation.entry.appended", {
          entry: { conversationId: "conv_b" },
        }),
      ),
      "conv_b",
    );
    assert.equal(
      conversationIdFromEvent(
        event("toolCall.updated", {
          toolCall: { conversationId: "conv_c" },
        }),
      ),
      "conv_c",
    );
    assert.equal(conversationIdFromEvent(event("run.started", {})), undefined);
  });
});
