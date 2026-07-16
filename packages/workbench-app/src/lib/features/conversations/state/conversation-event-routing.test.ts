import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationEventTypes } from "@nervekit/contracts";
import {
  conversationIdFromEvent,
  isConversationRuntimeEvent,
} from "./conversation-event-routing";

describe("conversation event routing", () => {
  it("routes every contract conversation event to the runtime reducer", () => {
    // `conversation.compacted` is intentionally handled separately in
    // conversation-events.ts via a full view refresh. Any other exclusion
    // means a contract event type is silently dropped by the reducer filter.
    const excluded = new Set<string>(["conversation.compacted"]);
    for (const type of conversationEventTypes) {
      assert.equal(
        isConversationRuntimeEvent(type),
        !excluded.has(type),
        `unexpected routing for '${type}'`,
      );
    }
  });

  it("routes run lifecycle and toolCall events after the v2 renames", () => {
    for (const type of [
      "run.started",
      "run.completed",
      "run.cancelled",
      "run.failed",
      "run.waiting",
      "run.suspended",
      "run.retrying",
      "toolCall.updated",
    ]) {
      assert.equal(isConversationRuntimeEvent(type), true, type);
    }
  });

  it("ignores unrelated event types", () => {
    for (const type of [
      "agent.configured",
      "conversation.navigated",
      "workspace.updated",
      "running",
    ]) {
      assert.equal(isConversationRuntimeEvent(type), false, type);
    }
  });

  it("extracts the conversation id from event payload shapes", () => {
    const base = {
      id: "evt_1",
      seq: 1,
      type: "run.started",
      ts: "2026-01-01T00:00:00.000Z",
      durability: "durable" as const,
    };
    assert.equal(
      conversationIdFromEvent({ ...base, data: { conversationId: "conv_a" } }),
      "conv_a",
    );
    assert.equal(
      conversationIdFromEvent({
        ...base,
        data: { entry: { conversationId: "conv_b" } },
      }),
      "conv_b",
    );
    assert.equal(
      conversationIdFromEvent({
        ...base,
        data: { toolCall: { conversationId: "conv_c" } },
      }),
      "conv_c",
    );
    assert.equal(conversationIdFromEvent({ ...base, data: {} }), undefined);
  });
});
