import { conversationEventTypes } from "@nervekit/contracts/conversations";
import {
  publicEventDefinition,
  type EventEnvelope,
} from "@nervekit/contracts/events";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConversationStreamEvent } from "./conversation-event-routing";

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
      if (publicEventDefinition(type)?.delivery !== "sequenced") continue;
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
});
