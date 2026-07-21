import { definePublicEvent } from "../events/event-definition.schema.js";
import { conversationEventPayloadSchemas } from "./conversation.schema.js";

export const conversationRuntimeEventDefinitions = Object.entries(
  conversationEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  definePublicEvent(name, payloadSchema, {
    delivery: "sequenced",
    supersedable: isBufferedConversationEvent(name),
    scope: conversationEventScope(name),
  }),
);

function isBufferedConversationEvent(name: string): boolean {
  return (
    name.startsWith("conversation.live.") ||
    name === "conversation.context.updated"
  );
}

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
