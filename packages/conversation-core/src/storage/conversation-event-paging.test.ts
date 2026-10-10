import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationEvent } from "@nervekit/contracts/core";
import { byteLimitedEvents } from "./conversation-event.repository.js";

test("event pages count UTF-8 bytes, omit agent projections and always make progress", () => {
  const response: ConversationEvent = {
    id: "evt_1",
    conversationId: "conv_1",
    sequence: 1,
    previousEventId: null,
    turnId: null,
    inputId: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    type: "tool_call_response",
    llmRepresentation: "user",
    payload: {
      toolCallId: "tool_1",
      providerCallId: null,
      toolName: "bash",
      arguments: {},
      origin: "user",
      assistantEventId: null,
      contentIndex: null,
      outcome: "completed",
      agentProjection: [{ type: "text", text: "huge".repeat(10000) }],
      userProjection: { argsPreview: {}, resultPreview: "界".repeat(50) },
      supervision: null,
      interactionResolution: null,
      resolutionRequestId: null,
      assetIds: [],
    },
  };
  const first = byteLimitedEvents([response])[0];
  assert.equal(first.type, "tool_call_response");
  assert.ok(!("agentProjection" in first.payload));
  const size = Buffer.byteLength(JSON.stringify(first));
  const next = { ...response, id: "evt_2", sequence: 2 };
  assert.equal(byteLimitedEvents([response, next], size * 2 + 2).length, 1);
  assert.equal(byteLimitedEvents([response, next], size * 2 + 3).length, 2);
  assert.equal(byteLimitedEvents([response, next], 1).length, 1);
  assert.ok("agentProjection" in response.payload);
});
