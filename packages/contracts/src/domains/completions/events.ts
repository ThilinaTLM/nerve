import { definePublicEvent } from "../../events/definition.js";
import { completionChangedSchema } from "./unified-completion.js";

export const completionEventDefinitions = [
  definePublicEvent("completion.changed", completionChangedSchema, {
    allowedSourceRoles: ["workbench_server"] as const,
    delivery: "ephemeral",
    coalescing: { strategy: "latest_by_scope" },
    scope: ["projectId", "conversationId"],
  }),
];
