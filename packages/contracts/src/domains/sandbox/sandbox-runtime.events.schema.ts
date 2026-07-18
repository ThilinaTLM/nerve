import { definePublicEvent } from "../events/event-definition.schema.js";
import { sandboxOperationalEventPayloadSchemas } from "./sandbox.events.schema.js";

export const sandboxRuntimeEventDefinitions = Object.entries(
  sandboxOperationalEventPayloadSchemas,
).map(([name, payloadSchema]) =>
  definePublicEvent(name, payloadSchema, {
    allowedSourceRoles: name.startsWith("run.")
      ? ["workbench_server", "sandbox_agent"]
      : ["sandbox_agent"],
    delivery: name === "run.delta" ? "ephemeral" : "sequenced",
    coalescing: name === "run.delta" ? "concat_delta" : undefined,
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
