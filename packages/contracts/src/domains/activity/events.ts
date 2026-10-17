import { definePublicEvent } from "../../events/definition.js";
import { activityUpdatedEventSchema } from "./activity.js";
export const activityEventDefinitions = [
  definePublicEvent("activity.updated", activityUpdatedEventSchema, {
    allowedSourceRoles: ["workbench_server"] as const,
    delivery: "ephemeral",
    coalescing: { strategy: "latest_by_scope" },
    scope: ["activity.id"],
  }),
];
