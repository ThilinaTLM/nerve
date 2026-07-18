import { definePublicEvent } from "../events/event-definition.schema.js";
import { subscriptionUsageSchema } from "./usage.schema.js";

const workbenchRoles = ["workbench_server"] as const;

export const usageEventDefinitions = [
  definePublicEvent("usage.subscription.updated", subscriptionUsageSchema, {
    allowedSourceRoles: workbenchRoles,
    delivery: "ephemeral",
    coalescing: "latest_by_scope",
    scope: ["provider"],
  }),
];
