import { definePublicEvent } from "../../events/definition.js";
import { maintenanceUpdatedEventSchema } from "./maintenance.js";
export const maintenanceEventDefinitions = [
  definePublicEvent("maintenance.updated", maintenanceUpdatedEventSchema, {
    allowedSourceRoles: ["workbench_server"] as const,
    delivery: "ephemeral",
    coalescing: { strategy: "latest_by_scope" },
    scope: ["operation.id"],
  }),
];
