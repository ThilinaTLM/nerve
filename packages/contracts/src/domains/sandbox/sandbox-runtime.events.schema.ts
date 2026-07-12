import { definePublicEvent } from "../events/event-definition.schema.js";
import { sandboxEventPayloadSchemas } from "./sandbox.events.schema.js";

export const sandboxRuntimeEventDefinitions = Object.entries(
  sandboxEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  definePublicEvent(name, payloadSchema, {
    durability:
      name === "run.delta" ||
      name === "conversation.context.updated" ||
      name.startsWith("conversation.live.")
        ? "transient"
        : "durable",
    coalescing: name.endsWith(".delta")
      ? "concat_delta"
      : name === "conversation.context.updated"
        ? "latest_by_scope"
        : undefined,
    scope: sandboxEventScope(name),
  }),
);

function sandboxEventScope(name: string): readonly string[] {
  if (
    name === "conversation.live.content.delta" ||
    name === "conversation.live.tool_draft.delta"
  ) {
    return [
      "sandboxId",
      "projectId",
      "conversationId",
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
      "sandboxId",
      "projectId",
      "conversationId",
      "runId",
      "turnId",
      "liveMessageId",
      "toolCallId",
      "contentIndex",
      "stream",
    ];
  }
  return [
    "sandboxId",
    "projectId",
    "conversationId",
    "agentId",
    "runId",
    "taskId",
    "toolCallId",
  ];
}
