import { definePublicEvent } from "../events/event-definition.schema.js";
import { sandboxOperationalEventPayloadSchemas } from "./sandbox.events.schema.js";

export const sandboxRuntimeEventDefinitions = Object.entries(
  sandboxOperationalEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  definePublicEvent(name, payloadSchema, {
    allowedSourceRoles: ["sandbox_agent"],
    durability: name === "run.delta" ? "transient" : "durable",
    coalescing: name.endsWith(".delta") ? "concat_delta" : undefined,
    scope: sandboxEventScope(),
  }),
);

function sandboxEventScope(): readonly string[] {
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
