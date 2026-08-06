import {
  defineContentEvent,
  definePublicEvent,
} from "../events/event-definition.schema.js";
import { conversationEventPayloadSchemas } from "./conversation.schema.js";

export const conversationRuntimeEventDefinitions = Object.entries(
  conversationEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  // conversation.entry.appended carries the full authoritative entry
  // (message text, thinking blocks), so it is validated with the
  // content-sized guard instead of the strict per-string bounded guard.
  name === "conversation.entry.appended"
    ? defineContentEvent(name, payloadSchema, {
        delivery: "sequenced",
        supersedable: isBufferedConversationEvent(name),
        scope: conversationEventScope(name),
      })
    : definePublicEvent(name, payloadSchema, {
        delivery: "sequenced",
        supersedable: isBufferedConversationEvent(name),
        scope: conversationEventScope(name),
      }),
);

function isBufferedConversationEvent(name: string): boolean {
  return (
    name.startsWith("conversation.live.") ||
    name === "conversation.context.updated" ||
    // Progress snapshots are idempotent tails; they never need a per-event fsync.
    name === "conversation.compaction.progress"
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
