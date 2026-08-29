import { definePublicEvent } from "../../events/definition.js";
import { subscriptionUsageSchema } from "./usage.js";

const workbenchRoles = ["workbench_server"] as const;

export const usageEventDefinitions = [
  definePublicEvent("usage.subscription.updated", subscriptionUsageSchema, {
    allowedSourceRoles: workbenchRoles,
    delivery: "ephemeral",
    coalescing: { strategy: "latest_by_scope" },
    scope: ["provider"],
  }),
];
