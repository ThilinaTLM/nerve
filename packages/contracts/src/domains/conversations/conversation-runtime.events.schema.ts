import { definePublicEvent } from "../events/event-definition.schema.js";
import { conversationEventPayloadSchemas } from "./conversation.schema.js";

export const conversationRuntimeEventDefinitions = Object.entries(
  conversationEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  definePublicEvent(name, payloadSchema, {
    delivery: "sequenced",
    supersedable:
      name.endsWith(".delta") || name === "conversation.context.updated",
    scope: conversationEventScope(name),
  }),
);

function conversationEventScope(name: string): readonly string[] {
  if (name === "conversation.live.turn.started") {
    return ["projectId", "conversationId", "agentId", "runId", "turnId"];
  }
  if (
    name === "conversation.live.content.delta" ||
    name === "conversation.live.tool_draft.delta"
  ) {
    return [
      "projectId",
      "conversationId",
      "agentId",
      "runId",
      "turnId",
      "liveMessageId",
      "contentBlockId",
      "contentIndex",
      "kind",
      "toolName",
      "providerToolCallId",
    ];
  }
  if (name === "conversation.live.tool_output.delta") {
    return [
      "projectId",
      "conversationId",
      "agentId",
      "runId",
      "turnId",
      "liveMessageId",
      "toolCallId",
      "contentIndex",
      "stream",
    ];
  }
  return ["projectId", "conversationId", "agentId", "runId", "toolCall.id"];
}
